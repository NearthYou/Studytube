from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from caption_utils import normalize_language, parse_timedtext_response
from youtube_runtime import youtube_cookie_file_cookies

try:
    import imageio_ffmpeg
except ModuleNotFoundError:  # pragma: no cover - optional ffmpeg fallback
    imageio_ffmpeg = None


YOUTUBE_SUBTITLE_PO_TOKEN_CACHE_TTL_SECONDS = 5 * 60 * 60
YOUTUBE_SUBTITLE_PO_TOKEN_CACHE: dict[str, tuple[float, tuple[str, str]]] = {}
AI_DIR = Path(__file__).resolve().parent
ROOT_DIR = AI_DIR.parent


@dataclass(frozen=True)
class YtDlpRuntime:
    http_available: Callable[[], bool]
    can_translate: Callable[[], bool]
    fetch_segments_from_urls: Callable[
        [list[str], str], tuple[list[dict[str, Any]], Exception | None]
    ]
    fetch_metadata: Callable[[str], tuple[dict[str, Any] | None, Exception | None]]
    fetch_caption_file: Callable[
        [str, str, str | None],
        tuple[list[dict[str, Any]], str, bool, Exception | None],
    ]
    commands: Callable[[], list[list[str]]]


_runtime: YtDlpRuntime | None = None


def configure_ytdlp_runtime(runtime: YtDlpRuntime) -> None:
    global _runtime
    _runtime = runtime


def ytdlp_runtime() -> YtDlpRuntime:
    if _runtime is None:
        raise RuntimeError("yt-dlp runtime is not configured")
    return _runtime

def fetch_yt_dlp_caption_segments(
    video_id: str,
    target_language: str,
) -> tuple[list[dict[str, Any]], str, bool, Exception | None]:
    if not ytdlp_runtime().http_available():
        return [], "", False, RuntimeError("http-client-unavailable")

    metadata, metadata_error = ytdlp_runtime().fetch_metadata(video_id)

    if not metadata:
        return [], "", False, metadata_error

    prefer_source_captions = ytdlp_runtime().can_translate()
    candidate = choose_yt_dlp_caption_candidate(
        metadata,
        target_language,
        prefer_source_captions=prefer_source_captions,
    )

    if not candidate:
        return [], "", False, RuntimeError("yt-dlp-caption-track-unavailable")

    segments, segment_error = ytdlp_runtime().fetch_segments_from_urls(
        [candidate["url"]],
        video_id,
    )

    if not segments:
        fallback_language = (
            candidate["sourceLanguage"] if prefer_source_captions else target_language
        )
        file_segments, file_language, file_translated, file_error = (
            ytdlp_runtime().fetch_caption_file(
                video_id,
                fallback_language,
                target_language,
            )
        )

        if file_segments:
            return file_segments, file_language, file_translated, None

        segment_error = file_error or segment_error

    return (
        segments,
        candidate["sourceLanguage"],
        bool(candidate["translated"]),
        segment_error,
    )


def fetch_yt_dlp_metadata(video_id: str) -> tuple[dict[str, Any] | None, Exception | None]:
    last_error: Exception | None = None
    url = f"https://www.youtube.com/watch?v={video_id}"

    with yt_dlp_secret_config_args() as secret_config_args:
        for command in ytdlp_runtime().commands():
            try:
                result = subprocess.run(
                    [
                        *command,
                        *yt_dlp_recovery_args(),
                        *secret_config_args,
                        *ffmpeg_location_args(),
                        "--dump-json",
                        "--skip-download",
                        "--ignore-no-formats",
                        "--no-warnings",
                        "--no-playlist",
                        url,
                    ],
                    capture_output=True,
                    check=False,
                    env=youtube_subprocess_environment(),
                    text=True,
                    timeout=25,
                )

                if result.returncode != 0:
                    last_error = sanitized_caption_exception(
                        RuntimeError(result.stderr or "yt-dlp failed")
                    )
                    continue

                data = json.loads(result.stdout)

                if isinstance(data, dict):
                    return data, None
            except Exception as exc:
                last_error = sanitized_caption_exception(exc)

    return None, last_error or RuntimeError("yt-dlp is not installed")


def fetch_yt_dlp_caption_file_segments(
    video_id: str,
    subtitle_language: str,
    target_language: str | None = None,
) -> tuple[list[dict[str, Any]], str, bool, Exception | None]:
    last_error: Exception | None = None
    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory(prefix="studytube-captions-") as temp_dir:
        temp_path = Path(temp_dir)
        output_template = str(temp_path / "%(id)s.%(ext)s")

        with yt_dlp_secret_config_args() as secret_config_args:
            for command in ytdlp_runtime().commands():
                for languages in yt_dlp_subtitle_language_attempts(subtitle_language):
                    try:
                        cleanup_temp_caption_files(temp_path)
                        result = subprocess.run(
                            [
                                *command,
                                *yt_dlp_recovery_args(),
                                *secret_config_args,
                                *ffmpeg_location_args(),
                                "--skip-download",
                                "--ignore-no-formats",
                                "--write-subs",
                                "--write-auto-subs",
                                "--sub-langs",
                                languages,
                                "--sub-format",
                                "json3/vtt/srv3/best",
                                "--no-warnings",
                                "--no-playlist",
                                "-o",
                                output_template,
                                url,
                            ],
                            capture_output=True,
                            check=False,
                            env=youtube_subprocess_environment(),
                            text=True,
                            timeout=45,
                        )

                        if result.returncode != 0:
                            last_error = sanitized_caption_exception(
                                RuntimeError(
                                    result.stderr or "yt-dlp subtitle download failed"
                                )
                            )
                            continue

                        parsed = parse_best_yt_dlp_subtitle_file(
                            temp_path,
                            subtitle_language,
                        )

                        if parsed:
                            segments, language = parsed
                            translated_target = target_language or subtitle_language

                            return (
                                segments,
                                language,
                                normalize_language(language) != translated_target,
                                None,
                            )
                    except Exception as exc:
                        last_error = sanitized_caption_exception(exc)

    return [], "", False, last_error or RuntimeError("yt-dlp subtitle download failed")


def yt_dlp_subtitle_language_attempts(target_language: str) -> list[str]:
    attempts = [
        ",".join(dict.fromkeys([target_language, "en", "ko"])),
    ]
    source_languages = ["en", "ko"]

    for language in source_languages:
        if language != target_language and language not in attempts:
            attempts.append(language)

    return attempts


def cleanup_temp_caption_files(directory: Path) -> None:
    for path in directory.iterdir():
        if path.is_file():
            try:
                path.unlink()
            except OSError:
                pass


def parse_best_yt_dlp_subtitle_file(
    directory: Path,
    target_language: str,
) -> tuple[list[dict[str, Any]], str] | None:
    files = [
        path
        for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in {".json3", ".vtt", ".srv3", ".ttml"}
    ]

    def rank(path: Path) -> tuple[int, int]:
        language = infer_yt_dlp_subtitle_language(path)
        extension_rank = {".json3": 0, ".srv3": 1, ".ttml": 2, ".vtt": 3}.get(
            path.suffix.lower(),
            9,
        )

        return (0 if language == target_language else 1, extension_rank)

    for path in sorted(files, key=rank):
        segments = parse_yt_dlp_subtitle_file(path)

        if segments:
            return segments, infer_yt_dlp_subtitle_language(path) or target_language

    return None


def infer_yt_dlp_subtitle_language(path: Path) -> str:
    parts = path.name.split(".")

    if len(parts) >= 3:
        return normalize_language(parts[-2])

    return ""


def parse_yt_dlp_subtitle_file(path: Path) -> list[dict[str, Any]]:
    raw_text = path.read_text(encoding="utf-8", errors="ignore")
    suffix = path.suffix.lower()

    if suffix == ".json3":
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError:
            return []

        return parse_json3_timedtext(data) if isinstance(data, dict) else []

    if suffix == ".vtt":
        return parse_webvtt_timedtext(raw_text)

    return parse_xml_timedtext(raw_text)


def yt_dlp_commands() -> list[list[str]]:
    configured = os.getenv("YT_DLP_PATH")
    commands: list[list[str]] = []

    if configured:
        commands.append([configured])

    executable = shutil.which("yt-dlp")

    if executable:
        commands.append([executable])

    if importlib.util.find_spec("yt_dlp") is not None:
        commands.append([sys.executable, "-m", "yt_dlp"])

    return commands


def yt_dlp_recovery_args() -> list[str]:
    args: list[str] = []
    js_runtime = os.getenv("YT_DLP_JS_RUNTIME", "").strip()
    if js_runtime:
        args.extend(["--js-runtimes", js_runtime])

    if truthy_env("YT_DLP_ALLOW_REMOTE_COMPONENTS"):
        args.extend(["--remote-components", "ejs:github"])

    bgutil_server_home = youtube_bgutil_server_home()
    if bgutil_server_home:
        args.extend(
            [
                "--extractor-args",
                f"youtubepot-bgutilscript:server_home={bgutil_server_home}",
            ]
        )

    cookies_file = os.getenv("YOUTUBE_COOKIES_FILE", "").strip()
    if cookies_file:
        args.extend(["--cookies", cookies_file])

    cookies_browser = os.getenv("YOUTUBE_COOKIES_FROM_BROWSER", "").strip()
    if cookies_browser:
        args.extend(["--cookies-from-browser", cookies_browser])

    return args


def yt_dlp_sensitive_recovery_args() -> list[str]:
    args: list[str] = []
    extractor_settings: list[str] = []
    for po_token in split_env_values(os.getenv("YOUTUBE_PO_TOKEN")):
        extractor_settings.append(f"po_token={po_token}")

    visitor_data = os.getenv("YOUTUBE_VISITOR_DATA", "").strip()
    if visitor_data:
        extractor_settings.append(f"visitor_data={visitor_data}")

    if youtube_bgutil_server_home():
        extractor_settings.append(
            f"fetch_pot={os.getenv('YT_DLP_FETCH_PO_TOKEN', 'always').strip() or 'always'}"
        )

    extra_extractor_args = os.getenv("YT_DLP_YOUTUBE_EXTRACTOR_ARGS", "").strip()
    if extra_extractor_args:
        extractor_settings.append(extra_extractor_args)

    if extractor_settings:
        args.extend(["--extractor-args", f"youtube:{';'.join(extractor_settings)}"])

    proxy_url = os.getenv("YOUTUBE_PROXY_URL", "").strip()
    if proxy_url:
        args.extend(["--proxy", proxy_url])

    return args


@contextmanager
def yt_dlp_secret_config_args():
    sensitive_args = yt_dlp_sensitive_recovery_args()
    if not sensitive_args:
        yield []
        return

    descriptor, config_path = tempfile.mkstemp(
        prefix="studytube-yt-dlp-",
        suffix=".conf",
        text=True,
    )
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        else:
            os.chmod(config_path, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as config_file:
            descriptor = -1
            for index in range(0, len(sensitive_args), 2):
                option = sensitive_args[index]
                value = sensitive_args[index + 1]
                config_file.write(f"{option} {shlex.quote(value)}\n")
            config_file.flush()
            os.fsync(config_file.fileno())
        yield ["--config-locations", config_path]
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(config_path)
        except FileNotFoundError:
            pass


def youtube_subprocess_environment() -> dict[str, str]:
    allowed_names = (
        "PATH",
        "HOME",
        "XDG_CACHE_HOME",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "TEMP",
        "TMP",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "NO_PROXY",
        "no_proxy",
        "SYSTEMROOT",
        "WINDIR",
        "PATHEXT",
        "COMSPEC",
    )
    environment = {
        name: value
        for name in allowed_names
        if (value := os.getenv(name)) is not None
    }
    proxy_url = os.getenv("YOUTUBE_PROXY_URL", "").strip()
    if proxy_url:
        environment["HTTP_PROXY"] = proxy_url
        environment["HTTPS_PROXY"] = proxy_url
        environment["NODE_USE_ENV_PROXY"] = "1"
    return environment


def caption_url_with_recovery_params(caption_url: str, video_id: str = "") -> str:
    subtitle_po_token = youtube_subtitle_po_token(video_id)
    if not subtitle_po_token:
        return caption_url

    parsed = urlparse(caption_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))

    if query.get("pot"):
        return caption_url

    client, token = subtitle_po_token

    return append_query_params(
        caption_url,
        {
            "c": client,
            "pot": token,
            "potc": "1",
        },
    )


def youtube_subtitle_po_token(video_id: str = "") -> tuple[str, str] | None:
    explicit_token = explicit_youtube_subtitle_po_token()
    if explicit_token:
        return explicit_token

    return generated_youtube_subtitle_po_token(video_id)


def explicit_youtube_subtitle_po_token() -> tuple[str, str] | None:
    for po_token in split_env_values(os.getenv("YOUTUBE_PO_TOKEN")):
        metadata, separator, token = po_token.partition("+")

        if not separator:
            return "WEB", po_token

        if not token:
            continue

        metadata_parts = [part for part in metadata.split(".") if part]
        client = metadata_parts[0] if metadata_parts else "web"
        contexts = {part.lower() for part in metadata_parts[1:]}

        if contexts and "subs" not in contexts:
            continue

        return client.upper(), token

    return None


def generated_youtube_subtitle_po_token(video_id: str) -> tuple[str, str] | None:
    normalized_video_id = str(video_id or "").strip()
    if not normalized_video_id or not truthy_env_default(
        "YOUTUBE_AUTO_SUBTITLE_PO_TOKEN",
        True,
    ):
        return None

    cached = YOUTUBE_SUBTITLE_PO_TOKEN_CACHE.get(normalized_video_id)
    if cached and time.time() - cached[0] < YOUTUBE_SUBTITLE_PO_TOKEN_CACHE_TTL_SECONDS:
        return cached[1]

    token = generate_bgutil_subtitle_po_token(normalized_video_id)
    if not token:
        return None

    response = ("WEB", token)
    YOUTUBE_SUBTITLE_PO_TOKEN_CACHE[normalized_video_id] = (time.time(), response)

    return response


def generate_bgutil_subtitle_po_token(video_id: str) -> str:
    server_home = youtube_bgutil_server_home()
    if not server_home:
        return ""

    node_path = youtube_node_runtime_path()
    script_path = Path(server_home) / "build" / "generate_once.js"
    if not node_path or not script_path.exists():
        return ""

    command = [node_path, str(script_path), "-c", video_id]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            env=youtube_subprocess_environment(),
            text=True,
            timeout=45,
            check=False,
        )
    except Exception:
        return ""

    if result.returncode:
        return ""

    for line in reversed(result.stdout.splitlines()):
        candidate = line.strip()
        if not candidate.startswith("{"):
            continue

        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue

        token = data.get("poToken")
        if isinstance(token, str) and token:
            return token

    return ""


def youtube_bgutil_server_home() -> str:
    configured = os.getenv("YOUTUBE_BGUTIL_SERVER_HOME", "").strip()
    candidates = [Path(configured)] if configured else []
    candidates.append(ROOT_DIR / ".tools" / "bgutil-ytdlp-pot-provider" / "server")

    for candidate in candidates:
        if candidate and (candidate / "build" / "generate_once.js").exists():
            return str(candidate)

    return ""


def youtube_node_runtime_path() -> str:
    js_runtime = os.getenv("YT_DLP_JS_RUNTIME", "").strip()
    if js_runtime:
        _runtime, _separator, runtime_path = js_runtime.partition(":")
        if runtime_path:
            return runtime_path

    return shutil.which("node") or ""


def sanitized_caption_exception(exc: Exception) -> Exception:
    message = str(exc)
    if "429" in message or "Too Many Requests" in message:
        return RuntimeError("youtube-caption-http-429")
    if isinstance(exc, subprocess.TimeoutExpired):
        return RuntimeError("youtube-caption-upstream-timeout")
    return RuntimeError("youtube-caption-upstream-failed")


def split_env_values(value: str | None) -> list[str]:
    if not value:
        return []

    return [part.strip() for part in value.replace(",", ";").split(";") if part.strip()]


def truthy_env(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def truthy_env_default(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


def ffmpeg_location_args() -> list[str]:
    configured = os.getenv("FFMPEG_PATH")

    if configured:
        return ["--ffmpeg-location", configured]

    executable = shutil.which("ffmpeg")

    if executable:
        return ["--ffmpeg-location", executable]

    if imageio_ffmpeg is not None:
        try:
            return ["--ffmpeg-location", imageio_ffmpeg.get_ffmpeg_exe()]
        except Exception:
            return []

    return []


def choose_yt_dlp_caption_candidate(
    metadata: dict[str, Any],
    target_language: str,
    *,
    prefer_source_captions: bool = False,
) -> dict[str, Any] | None:
    if prefer_source_captions:
        source = find_yt_dlp_caption_candidate(
            metadata,
            target_language,
            allow_any_language=True,
            prefer_untranslated=True,
        )

        if source:
            return source

    exact = find_yt_dlp_caption_candidate(
        metadata,
        target_language,
        allow_any_language=False,
        prefer_untranslated=False,
    )

    if exact:
        return exact

    return find_yt_dlp_caption_candidate(
        metadata,
        target_language,
        allow_any_language=True,
        prefer_untranslated=False,
    )


def find_yt_dlp_caption_candidate(
    metadata: dict[str, Any],
    target_language: str,
    *,
    allow_any_language: bool,
    prefer_untranslated: bool,
) -> dict[str, Any] | None:
    groups = [
        metadata.get("subtitles") if isinstance(metadata.get("subtitles"), dict) else {},
        (
            metadata.get("automatic_captions")
            if isinstance(metadata.get("automatic_captions"), dict)
            else {}
        ),
    ]
    preferred_sources = [
        language
        for language in ["en", "ko", "ja", "zh"]
        if language != target_language
    ]

    for tracks in groups:
        languages = list(tracks.keys())

        if prefer_untranslated:
            ordered_languages = [
                *[
                    language
                    for preferred in preferred_sources
                    for language in languages
                    if normalize_language(language) == preferred
                    and yt_dlp_language_has_untranslated_entry(tracks, language)
                ],
                *[
                    language
                    for language in languages
                    if normalize_language(language) != target_language
                    if yt_dlp_language_has_untranslated_entry(tracks, language)
                ],
                *[
                    language
                    for language in languages
                    if normalize_language(language) == target_language
                    and yt_dlp_language_has_untranslated_entry(tracks, language)
                ],
                *languages,
            ]
        elif allow_any_language:
            ordered_languages = [
                *[
                    language
                    for preferred in preferred_sources
                    for language in languages
                    if normalize_language(language) == preferred
                ],
                *languages,
            ]
        else:
            ordered_languages = [
                language
                for language in languages
                if normalize_language(language) == target_language
            ]

        for language in dict.fromkeys(ordered_languages):
            entries = tracks.get(language)

            if not isinstance(entries, list):
                continue

            entry = choose_yt_dlp_caption_entry(
                entries,
                prefer_untranslated=prefer_untranslated,
            )

            if entry:
                source_language = yt_dlp_caption_source_language(
                    language,
                    entry["url"],
                )

                return {
                    "url": entry["url"],
                    "sourceLanguage": source_language,
                    "translated": caption_url_requests_translation(entry["url"]),
                }

    return None


def yt_dlp_language_has_untranslated_entry(
    tracks: dict[str, Any],
    language: str,
) -> bool:
    entries = tracks.get(language)

    if not isinstance(entries, list):
        return False

    return any(
        isinstance(entry, dict)
        and isinstance(entry.get("url"), str)
        and not caption_url_requests_translation(str(entry["url"]))
        for entry in entries
    )


def choose_yt_dlp_caption_entry(
    entries: list[Any],
    *,
    prefer_untranslated: bool = False,
) -> dict[str, str] | None:
    valid_entries = [
        entry
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get("url"), str)
    ]
    if prefer_untranslated:
        untranslated_entries = [
            entry
            for entry in valid_entries
            if not caption_url_requests_translation(str(entry["url"]))
        ]

        if untranslated_entries:
            valid_entries = untranslated_entries

    preferred_extensions = ["json3", "srv3", "ttml", "vtt"]

    for extension in preferred_extensions:
        for entry in valid_entries:
            if str(entry.get("ext") or "").lower() == extension:
                return {"url": str(entry["url"])}

    if valid_entries:
        return {"url": str(valid_entries[0]["url"])}

    return None


def yt_dlp_caption_source_language(language: str, url: str) -> str:
    return (
        caption_url_query_language(url, "lang")
        or normalize_language(language)
        or "youtube"
    )


def caption_url_requests_translation(url: str) -> bool:
    return bool(caption_url_query_language(url, "tlang"))


def caption_url_query_language(url: str, name: str) -> str:
    try:
        parsed = urlparse(url)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    except Exception:
        return ""

    return normalize_language(query.get(name) or "")


def append_query_params(url: str, params: dict[str, str]) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)

    return urlunparse(parsed._replace(query=urlencode(query)))
