import {
  BoardRepository,
  Comment,
  CreatePostInput,
  LearningPreferences,
  PaginatedPosts,
  Playlist,
  PlaylistFeedback,
  StudyPost,
  UpdatePlaylistInput,
  UpdatePostInput,
  User,
} from './study-board.types';
import type {
  CreateVideoAssetInput,
  UpdateVideoAssetInput,
  VideoAsset,
} from './video-asset.types';

export type MemoryBoardState = {
  users: User[];
  posts: StudyPost[];
  playlists: Playlist[];
  videoAssets: VideoAsset[];
  nextIds: {
    post: number;
    comment: number;
    playlist: number;
    feedback: number;
    videoAsset: number;
  };
};

const nowIso = () => new Date().toISOString();

const defaultPreferences = (): LearningPreferences => ({
  interests: ['YouTube 학습', '프론트엔드'],
  pace: '하루 20분',
  goal: '짧은 영상으로 꾸준히 복습하기',
});

export class MemoryBoardRepository implements BoardRepository {
  protected users: User[] = [
    {
      id: 1,
      name: 'StudyTube Learner',
      email: 'learner@studytube.local',
      preferences: defaultPreferences(),
      createdAt: nowIso(),
    },
    {
      id: 2,
      name: 'Tech Curator',
      email: 'tech-curator@studytube.local',
      preferences: {
        interests: ['백엔드', '프론트엔드', '데이터베이스'],
        pace: '하루 30분',
        goal: '실제 강의 영상으로 개발 기본기를 빠르게 훑기',
      },
      createdAt: nowIso(),
    },
    {
      id: 3,
      name: 'Wellness Curator',
      email: 'wellness-curator@studytube.local',
      preferences: {
        interests: ['웰니스', '습관', '학습 루틴'],
        pace: '하루 15분',
        goal: '짧은 영상으로 몸과 마음의 리듬 회복하기',
      },
      createdAt: nowIso(),
    },
    {
      id: 4,
      name: 'Communication Curator',
      email: 'communication-curator@studytube.local',
      preferences: {
        interests: ['커뮤니케이션', '리더십', '심리'],
        pace: '주 3회',
        goal: 'TED 강연으로 말하기와 설득 감각 키우기',
      },
      createdAt: nowIso(),
    },
    {
      id: 5,
      name: 'DevOps Curator',
      email: 'devops-curator@studytube.local',
      preferences: {
        interests: ['devops', 'git', 'docker'],
        pace: '주 4회',
        goal: '배포와 협업 도구를 실습 흐름으로 익히기',
      },
      createdAt: nowIso(),
    },
    {
      id: 6,
      name: 'Data Curator',
      email: 'data-curator@studytube.local',
      preferences: {
        interests: ['데이터', 'SQL', '머신러닝'],
        pace: '하루 25분',
        goal: '데이터 분석과 머신러닝 입문 개념 연결하기',
      },
      createdAt: nowIso(),
    },
    {
      id: 7,
      name: 'Language Curator',
      email: 'language-curator@studytube.local',
      preferences: {
        interests: ['언어 학습', '영어', '학습법'],
        pace: '매일 10분',
        goal: '언어 학습 원리를 짧은 강연으로 복습하기',
      },
      createdAt: nowIso(),
    },
    {
      id: 8,
      name: 'Focus Curator',
      email: 'focus-curator@studytube.local',
      preferences: {
        interests: ['집중력', '생산성', '습관'],
        pace: '주 3회',
        goal: '시간 관리와 일하는 태도를 TED 강연으로 정리하기',
      },
      createdAt: nowIso(),
    },
  ];

  protected videoAssets: VideoAsset[] = [];

  protected posts: StudyPost[] = [
    {
      id: 1,
      authorId: 1,
      authorName: 'StudyTube Learner',
      title: 'React Hooks Course - All React Hooks Explained',
      videoUrl: 'https://www.youtube.com/watch?v=LlvBzyy-558',
      thumbnailUrl: 'https://i.ytimg.com/vi/LlvBzyy-558/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'A practical React hooks lesson covering useState, useEffect, useMemo, useCallback, and custom hooks through small examples.',
      translatedNotes:
        'useState, useEffect, useMemo, useCallback, 커스텀 훅을 작은 예제로 익히는 React 훅 실습 영상입니다.',
      tags: ['react', 'frontend', 'hooks'],
      comments: [
        {
          id: 1,
          postId: 1,
          authorId: 1,
          authorName: 'StudyTube Learner',
          body: 'useEffect dependency 설명이 입문자에게 특히 좋아요.',
          createdAt: nowIso(),
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 2,
      authorId: 1,
      authorName: 'StudyTube Learner',
      title: 'React Query Crash Course',
      videoUrl: 'https://www.youtube.com/watch?v=novnyCaa7To',
      thumbnailUrl: 'https://i.ytimg.com/vi/novnyCaa7To/hqdefault.jpg',
      channelName: 'The Net Ninja',
      summary:
        'Explains server state, caching, refetching, query keys, and mutation flows for React applications.',
      translatedNotes:
        'React 앱에서 서버 상태, 캐싱, 재조회, 쿼리 키, mutation 흐름을 설명합니다.',
      tags: ['react', 'query', 'frontend'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 101,
      authorId: 3,
      authorName: 'Wellness Curator',
      title: 'Yoga For Complete Beginners - 20 Minute Home Yoga Workout!',
      videoUrl: 'https://www.youtube.com/watch?v=v7AYKMP6rOE',
      thumbnailUrl: 'https://i.ytimg.com/vi/v7AYKMP6rOE/hqdefault.jpg',
      channelName: 'Yoga With Adriene',
      summary:
        'A gentle beginner yoga routine for stretching, breathing, and resetting the body at home.',
      translatedNotes:
        '집에서 따라 하기 좋은 입문 요가 루틴입니다. 호흡, 스트레칭, 기본 자세를 천천히 연결해 몸을 풀 수 있습니다.',
      tags: ['yoga', 'fitness', 'wellness'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 102,
      authorId: 3,
      authorName: 'Wellness Curator',
      title:
        'How to practice effectively...for just about anything - Annie Bosler and Don Greene',
      videoUrl: 'https://www.youtube.com/watch?v=f2O6mQkFiiw',
      thumbnailUrl: 'https://i.ytimg.com/vi/f2O6mQkFiiw/hqdefault.jpg',
      channelName: 'TED-Ed',
      summary:
        'Explains deliberate practice through music and skill-learning examples that apply across many hobbies.',
      translatedNotes:
        '악기 연습과 기술 학습 사례로 의도적 연습의 원리를 설명합니다. 취미, 공부, 운동 루틴에 모두 적용할 수 있습니다.',
      tags: ['learning', 'music', 'practice'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 103,
      authorId: 2,
      authorName: 'Tech Curator',
      title: 'Learn Python - Full Course for Beginners [Tutorial]',
      videoUrl: 'https://www.youtube.com/watch?v=rfscVS0vtbw',
      thumbnailUrl: 'https://i.ytimg.com/vi/rfscVS0vtbw/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'A beginner-friendly Python course covering syntax, functions, control flow, and practical programming basics.',
      translatedNotes:
        '파이썬 문법, 함수, 조건문과 반복문, 기초 프로젝트 흐름을 긴 호흡으로 익히는 입문 강의입니다.',
      tags: ['python', 'programming', 'beginner'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 104,
      authorId: 2,
      authorName: 'Tech Curator',
      title: 'Learn JavaScript - Full Course for Beginners',
      videoUrl: 'https://www.youtube.com/watch?v=PkZNo7MFNFg',
      thumbnailUrl: 'https://i.ytimg.com/vi/PkZNo7MFNFg/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'A full JavaScript fundamentals course for variables, functions, objects, arrays, and browser scripting.',
      translatedNotes:
        '변수, 함수, 객체, 배열, 브라우저 스크립팅까지 자바스크립트 기초를 한 번에 훑는 강의입니다.',
      tags: ['javascript', 'programming', 'frontend'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 105,
      authorId: 4,
      authorName: 'Communication Curator',
      title: 'The Power of Vulnerability | Brené Brown | TED',
      videoUrl: 'https://www.youtube.com/watch?v=iCvmsMzlF7o',
      thumbnailUrl: 'https://i.ytimg.com/vi/iCvmsMzlF7o/hqdefault.jpg',
      channelName: 'TED',
      summary:
        'A widely shared talk about vulnerability, connection, courage, and how people build trust.',
      translatedNotes:
        '취약성, 용기, 연결감, 신뢰 형성에 대한 TED 강연입니다. 커뮤니케이션과 자기 이해 학습에 좋습니다.',
      tags: ['psychology', 'communication', 'ted'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 106,
      authorId: 4,
      authorName: 'Communication Curator',
      title: 'Your Body Language May Shape Who You Are | Amy Cuddy | TED',
      videoUrl: 'https://www.youtube.com/watch?v=Ks-_Mh1QhMc',
      thumbnailUrl: 'https://i.ytimg.com/vi/Ks-_Mh1QhMc/hqdefault.jpg',
      channelName: 'TED',
      summary:
        'Explores how posture, presence, and nonverbal cues can affect confidence and communication.',
      translatedNotes:
        '자세와 비언어적 표현이 자신감과 소통에 어떤 영향을 주는지 다루는 발표 학습 영상입니다.',
      tags: ['communication', 'psychology', 'presentation'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 107,
      authorId: 4,
      authorName: 'Communication Curator',
      title: 'How Great Leaders Inspire Action | Simon Sinek | TED',
      videoUrl: 'https://www.youtube.com/watch?v=qp0HIF3SfI4',
      thumbnailUrl: 'https://i.ytimg.com/vi/qp0HIF3SfI4/hqdefault.jpg',
      channelName: 'TED',
      summary:
        'Introduces the golden circle framework for purpose-driven leadership, branding, and decision-making.',
      translatedNotes:
        '왜에서 시작하는 골든 서클 프레임워크를 통해 리더십, 브랜딩, 의사결정 방식을 설명합니다.',
      tags: ['leadership', 'business', 'ted'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 3,
      authorId: 2,
      authorName: 'Tech Curator',
      title: 'FastAPI Full Course',
      videoUrl: 'https://www.youtube.com/watch?v=7t2alSnE2-I',
      thumbnailUrl: 'https://i.ytimg.com/vi/7t2alSnE2-I/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'Builds Python APIs with routing, validation, dependency injection, authentication, and database access.',
      translatedNotes:
        '라우팅, 검증, 의존성 주입, 인증, 데이터베이스 접근으로 Python API를 만드는 강의입니다.',
      tags: ['fastapi', 'python', 'backend'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 4,
      authorId: 2,
      authorName: 'Tech Curator',
      title: 'PostgreSQL Tutorial for Beginners',
      videoUrl: 'https://www.youtube.com/watch?v=qw--VYLpxG4',
      thumbnailUrl: 'https://i.ytimg.com/vi/qw--VYLpxG4/hqdefault.jpg',
      channelName: 'Programming with Mosh',
      summary:
        'Introduces relational tables, filtering, joins, indexes, and the mindset for designing durable data models.',
      translatedNotes:
        '관계형 테이블, 필터링, 조인, 인덱스, 안정적인 데이터 모델 설계를 소개합니다.',
      tags: ['postgresql', 'database', 'backend'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 201,
      authorId: 5,
      authorName: 'DevOps Curator',
      title:
        'Docker Tutorial for Beginners - A Full DevOps Course on How to Run Applications in Containers',
      videoUrl: 'https://www.youtube.com/watch?v=fqMOX6JJhGo',
      thumbnailUrl: 'https://i.ytimg.com/vi/fqMOX6JJhGo/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'A practical Docker course covering images, containers, ports, volumes, Docker Compose, and deployment workflows.',
      translatedNotes:
        '이미지, 컨테이너, 포트, 볼륨, Docker Compose와 배포 흐름을 실습 중심으로 익히는 DevOps 입문 강의입니다.',
      tags: ['docker', 'devops', 'backend'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 202,
      authorId: 5,
      authorName: 'DevOps Curator',
      title: 'Git and GitHub for Beginners - Crash Course',
      videoUrl: 'https://www.youtube.com/watch?v=RGOj5yH7evk',
      thumbnailUrl: 'https://i.ytimg.com/vi/RGOj5yH7evk/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'Introduces Git commits, branches, pull requests, remotes, and GitHub collaboration for new developers.',
      translatedNotes:
        '커밋, 브랜치, 원격 저장소, 풀 리퀘스트를 따라 하며 Git과 GitHub 협업 흐름을 익히는 입문 강의입니다.',
      tags: ['git', 'github', 'devops'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 203,
      authorId: 6,
      authorName: 'Data Curator',
      title: 'SQL Tutorial - Full Database Course for Beginners',
      videoUrl: 'https://www.youtube.com/watch?v=HXV3zeQKqGY',
      thumbnailUrl: 'https://i.ytimg.com/vi/HXV3zeQKqGY/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'A full SQL course covering tables, select queries, filtering, joins, grouping, and database design basics.',
      translatedNotes:
        '테이블, SELECT, 필터링, 조인, 그룹화, 데이터베이스 설계 기초를 한 번에 정리하는 SQL 입문 강의입니다.',
      tags: ['sql', 'database', 'data'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 204,
      authorId: 6,
      authorName: 'Data Curator',
      title: 'Machine Learning for Everybody - Full Course',
      videoUrl: 'https://www.youtube.com/watch?v=i_LwzRVP7bg',
      thumbnailUrl: 'https://i.ytimg.com/vi/i_LwzRVP7bg/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'Explains machine learning concepts, model training, evaluation, and common algorithms for beginners.',
      translatedNotes:
        '머신러닝의 기본 개념, 모델 학습과 평가, 대표 알고리즘을 입문자 관점에서 차근차근 설명합니다.',
      tags: ['machine-learning', 'data', 'python'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 205,
      authorId: 6,
      authorName: 'Data Curator',
      title: 'The beauty of data visualization - David McCandless',
      videoUrl: 'https://www.youtube.com/watch?v=5Zg-C8AAIGg',
      thumbnailUrl: 'https://i.ytimg.com/vi/5Zg-C8AAIGg/hqdefault.jpg',
      channelName: 'TED',
      summary:
        'Shows how visual patterns can reveal hidden relationships and make complex data easier to understand.',
      translatedNotes:
        '복잡한 데이터 속 관계를 시각 패턴으로 드러내고, 데이터 시각화가 이해를 어떻게 돕는지 보여주는 강연입니다.',
      tags: ['data', 'visualization', 'ted'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 206,
      authorId: 7,
      authorName: 'Language Curator',
      title: 'How to learn any language in six months | Chris Lonsdale',
      videoUrl: 'https://www.youtube.com/watch?v=d0yGdNEWdn0',
      thumbnailUrl: 'https://i.ytimg.com/vi/d0yGdNEWdn0/hqdefault.jpg',
      channelName: 'TEDx Talks',
      summary:
        'Presents practical principles for accelerating language learning through context, listening, and useful phrases.',
      translatedNotes:
        '맥락, 듣기, 자주 쓰는 표현 중심으로 언어 학습 속도를 높이는 원칙을 정리한 TEDx 강연입니다.',
      tags: ['language', 'learning', 'tedx'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 207,
      authorId: 7,
      authorName: 'Language Curator',
      title: 'The secrets of learning a new language | Lýdia Machová',
      videoUrl: 'https://www.youtube.com/watch?v=o_XVt5rdpFY',
      thumbnailUrl: 'https://i.ytimg.com/vi/o_XVt5rdpFY/hqdefault.jpg',
      channelName: 'TED',
      summary:
        'Explains how polyglots build enjoyable systems, repeat consistently, and design language habits that last.',
      translatedNotes:
        '다국어 학습자들이 즐거운 시스템, 꾸준한 반복, 지속 가능한 습관으로 언어를 익히는 방식을 소개합니다.',
      tags: ['language', 'learning', 'ted'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 208,
      authorId: 8,
      authorName: 'Focus Curator',
      title: 'Inside the Mind of a Master Procrastinator | Tim Urban | TED',
      videoUrl: 'https://www.youtube.com/watch?v=arj7oStGLkU',
      thumbnailUrl: 'https://i.ytimg.com/vi/arj7oStGLkU/hqdefault.jpg',
      channelName: 'TED',
      summary:
        'Uses humor and simple metaphors to explain procrastination, deadlines, panic, and long-term self-management.',
      translatedNotes:
        '미루기의 심리, 마감의 압박, 장기 목표 관리 문제를 유머와 비유로 풀어내는 생산성 강연입니다.',
      tags: ['productivity', 'habits', 'ted'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 209,
      authorId: 8,
      authorName: 'Focus Curator',
      title: 'The happy secret to better work | Shawn Achor',
      videoUrl: 'https://www.youtube.com/watch?v=fLJsdqxnZb0',
      thumbnailUrl: 'https://i.ytimg.com/vi/fLJsdqxnZb0/hqdefault.jpg',
      channelName: 'TED',
      summary:
        'Connects happiness, mindset, and performance to show how positive habits can improve the way people work.',
      translatedNotes:
        '행복, 사고방식, 성과의 관계를 설명하며 긍정적인 습관이 일하는 방식에 주는 영향을 정리합니다.',
      tags: ['productivity', 'work', 'ted'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 210,
      authorId: 4,
      authorName: 'Communication Curator',
      title: 'How to Speak So That People Want to Listen | Julian Treasure',
      videoUrl: 'https://www.youtube.com/watch?v=eIho2S0ZahI',
      thumbnailUrl: 'https://i.ytimg.com/vi/eIho2S0ZahI/hqdefault.jpg',
      channelName: 'TED',
      summary:
        'Breaks down speaking habits, vocal tools, and listening cues that help people communicate with more impact.',
      translatedNotes:
        '말하기 습관, 목소리 도구, 듣는 사람이 집중하게 만드는 표현 방식을 정리한 커뮤니케이션 강연입니다.',
      tags: ['communication', 'speaking', 'ted'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 211,
      authorId: 5,
      authorName: 'DevOps Curator',
      title: 'Kubernetes Tutorial for Beginners [FULL COURSE in 4 Hours]',
      videoUrl: 'https://www.youtube.com/watch?v=X48VuDVv0do',
      thumbnailUrl: 'https://i.ytimg.com/vi/X48VuDVv0do/hqdefault.jpg',
      channelName: 'TechWorld with Nana',
      summary:
        'Introduces Kubernetes concepts, pods, services, deployments, config maps, and cluster workflow basics.',
      translatedNotes:
        'Pod, Service, Deployment, ConfigMap과 클러스터 운영 흐름을 입문자 눈높이에서 설명하는 Kubernetes 강의입니다.',
      tags: ['kubernetes', 'devops', 'backend'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 212,
      authorId: 2,
      authorName: 'Tech Curator',
      title:
        'TypeScript Course for Beginners 2021 - Learn TypeScript from Scratch!',
      videoUrl: 'https://www.youtube.com/watch?v=BwuLxPH8IDs',
      thumbnailUrl: 'https://i.ytimg.com/vi/BwuLxPH8IDs/hqdefault.jpg',
      channelName: 'Academind',
      summary:
        'Covers TypeScript types, interfaces, classes, generics, compiler settings, and safer JavaScript workflows.',
      translatedNotes:
        '타입, 인터페이스, 클래스, 제네릭, 컴파일 설정을 통해 JavaScript를 더 안전하게 작성하는 방법을 배웁니다.',
      tags: ['typescript', 'frontend', 'programming'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 213,
      authorId: 2,
      authorName: 'Tech Curator',
      title: 'Next.js 13 Full Course 2023 | Build and Deploy a Full Stack App',
      videoUrl: 'https://www.youtube.com/watch?v=wm5gMKuwSYk',
      thumbnailUrl: 'https://i.ytimg.com/vi/wm5gMKuwSYk/hqdefault.jpg',
      channelName: 'JavaScript Mastery',
      summary:
        'Builds a modern Next.js app while covering routing, server components, data fetching, and deployment.',
      translatedNotes:
        '라우팅, 서버 컴포넌트, 데이터 패칭, 배포까지 이어지는 Next.js 기반 풀스택 앱 제작 흐름을 익힙니다.',
      tags: ['nextjs', 'frontend', 'react'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 214,
      authorId: 3,
      authorName: 'Wellness Curator',
      title: '10-Minute Meditation For Anxiety',
      videoUrl: 'https://www.youtube.com/watch?v=O-6f5wQXSu8',
      thumbnailUrl: 'https://i.ytimg.com/vi/O-6f5wQXSu8/hqdefault.jpg',
      channelName: 'Goodful',
      summary:
        'A short guided meditation for calming anxiety, returning to the breath, and resetting attention.',
      translatedNotes:
        '불안을 가라앉히고 호흡으로 돌아오며 주의를 다시 정돈하는 짧은 가이드 명상 영상입니다.',
      tags: ['meditation', 'wellness', 'focus'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 215,
      authorId: 3,
      authorName: 'Wellness Curator',
      title: 'The science of sleep and the effects of sleep deprivation',
      videoUrl: 'https://www.youtube.com/watch?v=gedoSfZvBgE',
      thumbnailUrl: 'https://i.ytimg.com/vi/gedoSfZvBgE/hqdefault.jpg',
      channelName: 'TED-Ed',
      summary:
        'Explains sleep cycles, memory, health effects, and why sleep deprivation harms learning and attention.',
      translatedNotes:
        '수면 주기, 기억, 건강 영향, 수면 부족이 학습과 집중에 미치는 영향을 설명하는 TED-Ed 영상입니다.',
      tags: ['sleep', 'wellness', 'learning'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 216,
      authorId: 6,
      authorName: 'Data Curator',
      title: 'Statistics - A Full University Course on Data Science Basics',
      videoUrl: 'https://www.youtube.com/watch?v=xxpc-HPKN28',
      thumbnailUrl: 'https://i.ytimg.com/vi/xxpc-HPKN28/hqdefault.jpg',
      channelName: 'freeCodeCamp.org',
      summary:
        'A statistics course covering distributions, probability, inference, regression, and data science foundations.',
      translatedNotes:
        '분포, 확률, 추론, 회귀와 데이터 과학 기초를 연결해 배우는 통계 입문 강의입니다.',
      tags: ['statistics', 'data', 'math'],
      comments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  protected playlists: Playlist[] = [
    {
      id: 1,
      ownerId: 2,
      title: 'React 기초 복습 루트',
      description: 'React 훅과 서버 상태 관리를 차례대로 복습합니다.',
      postIds: [1, 2],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 2,
      ownerId: 2,
      title: '랜덤 테크 스타터 팩',
      description:
        '프론트엔드, 파이썬, 백엔드, 데이터베이스를 실제 강의 영상으로 빠르게 훑는 랜덤 테크 믹스입니다.',
      postIds: [104, 103, 3, 4],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 3,
      ownerId: 3,
      title: '몸과 마음 리셋 루틴',
      description:
        '요가, 연습법, 취약성 강연을 묶어 몸을 풀고 학습 리듬을 다시 잡는 웰니스 플레이리스트입니다.',
      postIds: [101, 102, 105],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 4,
      ownerId: 4,
      title: '커뮤니케이션 TED 믹스',
      description:
        '발표, 심리, 리더십을 TED 강연으로 이어 보는 커뮤니케이션 중심 랜덤 큐레이션입니다.',
      postIds: [106, 107, 105],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 5,
      ownerId: 2,
      title: '프론트엔드 복습 루트',
      description:
        'React hooks, React Query, JavaScript 기본기를 한 번에 복습하는 웹 개발 플레이리스트입니다.',
      postIds: [1, 2, 104],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 6,
      ownerId: 5,
      title: 'DevOps 입문 트랙',
      description:
        'Git 협업에서 Docker, Kubernetes까지 배포 흐름을 차례대로 훑는 운영 입문 플레이리스트입니다.',
      postIds: [202, 201, 211],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 7,
      ownerId: 6,
      title: 'SQL 데이터 분석 스타터',
      description:
        'SQL, 통계, 데이터 시각화, 머신러닝을 이어 보며 데이터 분석 기본 감각을 만드는 루트입니다.',
      postIds: [203, 216, 205, 204],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 8,
      ownerId: 7,
      title: '언어 학습 가속 루트',
      description:
        '언어를 빠르게 배우는 원리와 꾸준한 학습 시스템을 강연으로 복습하는 플레이리스트입니다.',
      postIds: [206, 207, 102],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 9,
      ownerId: 8,
      title: '집중력 회복 TED 루트',
      description:
        '미루기, 행복, 명상, 수면을 묶어 집중력과 학습 컨디션을 다시 잡는 TED 중심 루트입니다.',
      postIds: [208, 209, 214, 215],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 10,
      ownerId: 6,
      title: 'CS 기초 넓게 보기',
      description:
        'JavaScript, TypeScript, SQL, 머신러닝을 넓게 훑으며 개발 학습의 기본 지도를 만드는 코스입니다.',
      postIds: [104, 212, 203, 204],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 11,
      ownerId: 4,
      title: '말하기와 설득 연습',
      description:
        '목소리, 몸짓, 리더십 강연을 연결해 발표와 설득의 기본기를 복습하는 커뮤니케이션 코스입니다.',
      postIds: [210, 106, 107],
      feedback: [],
      createdAt: nowIso(),
    },
    {
      id: 12,
      ownerId: 2,
      title: '모던 웹 풀스택 루트',
      description:
        'React, TypeScript, Next.js, Git 협업을 묶어 프론트엔드에서 풀스택 배포까지 이어 보는 루트입니다.',
      postIds: [1, 212, 213, 202],
      feedback: [],
      createdAt: nowIso(),
    },
  ];

  protected nextIds = {
    post: 217,
    comment: 2,
    playlist: 13,
    feedback: 1,
    videoAsset: 1,
  };

  async listPosts(input: {
    authorId?: number;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedPosts> {
    await this.idle();

    const normalized = input.search?.trim().toLowerCase();
    const owned =
      typeof input.authorId === 'number'
        ? this.posts.filter((post) => post.authorId === input.authorId)
        : [...this.posts];
    const filtered = normalized
      ? owned.filter((post) =>
          [
            post.title,
            post.summary,
            post.channelName,
            post.translatedNotes,
            ...post.tags,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalized),
        )
      : owned;
    const start = (input.page - 1) * input.pageSize;

    return {
      items: filtered.slice(start, start + input.pageSize).map((post) => ({
        ...post,
        comments: [...post.comments],
        tags: [...post.tags],
      })),
      total: filtered.length,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  async findPost(id: number): Promise<StudyPost | null> {
    await this.idle();

    const post = this.posts.find((candidate) => candidate.id === id);

    return post
      ? {
          ...post,
          comments: [...post.comments],
          tags: [...post.tags],
        }
      : null;
  }

  async createPost(input: CreatePostInput): Promise<StudyPost> {
    await this.idle();

    const author = this.users.find((user) => user.id === input.authorId);

    if (!author) {
      throw new Error('Author not found');
    }

    const timestamp = nowIso();
    const post: StudyPost = {
      id: this.nextIds.post++,
      authorId: input.authorId,
      authorName: author.name,
      title: input.title,
      videoUrl: input.videoUrl,
      thumbnailUrl:
        input.thumbnailUrl ??
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      channelName: input.channelName ?? 'Unknown channel',
      summary: input.summary,
      translatedNotes: input.translatedNotes,
      tags: this.normalizeTags(input.tags),
      comments: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.posts.unshift(post);
    await this.persistState();

    return { ...post, comments: [], tags: [...post.tags] };
  }

  async updatePost(
    id: number,
    input: UpdatePostInput,
  ): Promise<StudyPost | null> {
    await this.idle();

    const index = this.posts.findIndex((post) => post.id === id);

    if (index === -1) {
      return null;
    }

    const current = this.posts[index];
    const next: StudyPost = {
      ...current,
      ...input,
      tags: input.tags ? this.normalizeTags(input.tags) : current.tags,
      updatedAt: nowIso(),
    };
    this.posts[index] = next;
    await this.persistState();

    return { ...next, comments: [...next.comments], tags: [...next.tags] };
  }

  async deletePost(id: number): Promise<boolean> {
    await this.idle();

    const before = this.posts.length;
    this.posts = this.posts.filter((post) => post.id !== id);
    this.playlists = this.playlists.map((playlist) => ({
      ...playlist,
      postIds: playlist.postIds.filter((postId) => postId !== id),
    }));
    if (this.posts.length !== before) {
      this.videoAssets = this.videoAssets.filter((asset) => {
        return asset.postId !== id;
      });
      await this.persistState();
    }

    return this.posts.length !== before;
  }

  hasCompletedCourseBackfillAuditForPost(postId: number): Promise<boolean> {
    void postId;
    return Promise.resolve(false);
  }

  async findVideoAsset(postId: number): Promise<VideoAsset | null> {
    await this.idle();

    const asset = this.videoAssets.find((candidate) => {
      return candidate.postId === postId;
    });

    return asset ? this.cloneVideoAsset(asset) : null;
  }

  async upsertVideoAsset(input: CreateVideoAssetInput): Promise<VideoAsset> {
    await this.idle();

    const postExists = this.posts.some((post) => {
      return post.id === input.postId;
    });

    if (!postExists) {
      throw new Error('Post not found for video asset');
    }

    const existingIndex = this.videoAssets.findIndex((candidate) => {
      return candidate.postId === input.postId;
    });
    const timestamp = nowIso();

    if (existingIndex >= 0) {
      const current = this.videoAssets[existingIndex];
      const next: VideoAsset = {
        ...current,
        videoId: input.videoId,
        videoUrl: input.videoUrl,
        language: input.language ?? current.language,
        errorMessage: '',
        updatedAt: timestamp,
      };
      this.videoAssets[existingIndex] = next;
      await this.persistState();

      return this.cloneVideoAsset(next);
    }

    const asset: VideoAsset = {
      id: this.nextIds.videoAsset++,
      postId: input.postId,
      videoId: input.videoId,
      videoUrl: input.videoUrl,
      language: input.language ?? 'ko',
      sourceLanguage: '',
      status: 'pending',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
      sourceSegments: [],
      translatedSegments: [],
      summarySections: [],
      transcriptBody: '',
      errorMessage: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.videoAssets.push(asset);
    await this.persistState();

    return this.cloneVideoAsset(asset);
  }

  async requestVideoAssetPreparation(
    input: CreateVideoAssetInput,
  ): Promise<VideoAsset> {
    const current = await this.findVideoAsset(input.postId);
    const sourceChanged =
      current !== null &&
      (current.videoId !== input.videoId ||
        current.videoUrl !== input.videoUrl);
    const asset = await this.upsertVideoAsset(input);
    return (
      (await this.updateVideoAsset(input.postId, {
        status: 'processing',
        sourceCaptionStatus: 'pending',
        translationStatus: 'pending',
        summaryStatus: 'pending',
        sourceSegments: sourceChanged ? [] : undefined,
        translatedSegments: sourceChanged ? [] : undefined,
        summarySections: sourceChanged ? [] : undefined,
        transcriptBody: sourceChanged ? '' : undefined,
        errorMessage: '',
      })) ?? asset
    );
  }

  async updateVideoAsset(
    postId: number,
    input: UpdateVideoAssetInput,
  ): Promise<VideoAsset | null> {
    await this.idle();

    const index = this.videoAssets.findIndex((candidate) => {
      return candidate.postId === postId;
    });

    if (index === -1) {
      return null;
    }

    const current = this.videoAssets[index];
    const next: VideoAsset = {
      ...current,
      ...input,
      sourceSegments:
        input.sourceSegments === undefined
          ? current.sourceSegments
          : this.cloneVideoAssetSegments(input.sourceSegments),
      translatedSegments:
        input.translatedSegments === undefined
          ? current.translatedSegments
          : this.cloneVideoAssetSegments(input.translatedSegments),
      summarySections:
        input.summarySections === undefined
          ? current.summarySections
          : this.cloneVideoAssetSummarySections(input.summarySections),
      updatedAt: nowIso(),
    };
    this.videoAssets[index] = next;
    await this.persistState();

    return this.cloneVideoAsset(next);
  }

  async addComment(input: {
    postId: number;
    authorId: number;
    body: string;
  }): Promise<Comment> {
    await this.idle();

    const post = this.posts.find((candidate) => candidate.id === input.postId);
    const author = this.users.find(
      (candidate) => candidate.id === input.authorId,
    );

    if (!post || !author) {
      throw new Error('Post or author not found');
    }

    const comment: Comment = {
      id: this.nextIds.comment++,
      postId: input.postId,
      authorId: input.authorId,
      authorName: author.name,
      body: input.body,
      createdAt: nowIso(),
    };
    post.comments.push(comment);
    await this.persistState();

    return comment;
  }

  async deleteComment(postId: number, commentId: number): Promise<boolean> {
    await this.idle();

    const post = this.posts.find((candidate) => candidate.id === postId);

    if (!post) {
      return false;
    }

    const before = post.comments.length;
    post.comments = post.comments.filter((comment) => comment.id !== commentId);
    if (post.comments.length !== before) {
      await this.persistState();
    }

    return post.comments.length !== before;
  }

  async listPlaylists(ownerId?: number): Promise<Playlist[]> {
    await this.idle();

    return this.playlists
      .filter((playlist) => (ownerId ? playlist.ownerId === ownerId : true))
      .map((playlist) => this.clonePlaylist(playlist));
  }

  async createPlaylist(input: {
    ownerId: number;
    title: string;
    description: string;
    postIds: number[];
  }): Promise<Playlist> {
    await this.idle();

    const playlist: Playlist = {
      id: this.nextIds.playlist++,
      ownerId: input.ownerId,
      title: input.title,
      description: input.description,
      postIds: [...new Set(input.postIds)],
      feedback: [],
      createdAt: nowIso(),
    };
    this.playlists.unshift(playlist);
    await this.persistState();

    return this.clonePlaylist(playlist);
  }

  async updatePlaylist(
    id: number,
    input: UpdatePlaylistInput,
  ): Promise<Playlist | null> {
    await this.idle();

    const index = this.playlists.findIndex((playlist) => playlist.id === id);

    if (index === -1) {
      return null;
    }

    const current = this.playlists[index];
    const next: Playlist = {
      ...current,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      postIds:
        input.postIds !== undefined
          ? [...new Set(input.postIds)]
          : current.postIds,
    };
    this.playlists[index] = next;
    await this.persistState();

    return this.clonePlaylist(next);
  }

  async deletePlaylist(id: number): Promise<boolean> {
    await this.idle();

    const before = this.playlists.length;
    this.playlists = this.playlists.filter((playlist) => playlist.id !== id);
    if (this.playlists.length !== before) {
      await this.persistState();
    }

    return this.playlists.length !== before;
  }

  async addPlaylistItem(
    playlistId: number,
    postId: number,
  ): Promise<Playlist | null> {
    await this.idle();

    const playlist = this.playlists.find(
      (candidate) => candidate.id === playlistId,
    );

    if (!playlist) {
      return null;
    }

    if (!playlist.postIds.includes(postId)) {
      playlist.postIds.push(postId);
      await this.persistState();
    }

    return this.clonePlaylist(playlist);
  }

  async addPlaylistFeedback(input: {
    playlistId: number;
    authorId: number;
    rating: number;
    body: string;
  }): Promise<PlaylistFeedback> {
    await this.idle();

    const playlist = this.playlists.find(
      (candidate) => candidate.id === input.playlistId,
    );

    if (!playlist) {
      throw new Error('Playlist not found');
    }

    const feedback: PlaylistFeedback = {
      id: this.nextIds.feedback++,
      playlistId: input.playlistId,
      authorId: input.authorId,
      authorName:
        this.users.find((user) => user.id === input.authorId)?.name ?? 'User',
      rating: input.rating,
      body: input.body,
      createdAt: nowIso(),
    };
    playlist.feedback.push(feedback);
    await this.persistState();

    return feedback;
  }

  private clonePlaylist(playlist: Playlist): Playlist {
    return {
      ...playlist,
      postIds: [...playlist.postIds],
      feedback: [...playlist.feedback],
    };
  }

  private normalizeTags(tags: string[]): string[] {
    return [
      ...new Set(
        tags
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0),
      ),
    ];
  }

  protected snapshotState(): MemoryBoardState {
    return this.cloneState({
      users: this.users,
      posts: this.posts,
      playlists: this.playlists,
      videoAssets: this.videoAssets,
      nextIds: this.nextIds,
    });
  }

  protected restoreState(state: MemoryBoardState) {
    this.users = this.cloneState(state.users);
    this.posts = this.cloneState(state.posts);
    this.playlists = this.cloneState(state.playlists);
    this.videoAssets = this.cloneState(state.videoAssets ?? []);
    this.nextIds = this.cloneState({
      ...this.nextIds,
      ...state.nextIds,
      videoAsset: state.nextIds.videoAsset ?? this.nextIds.videoAsset,
    });
  }

  protected persistState(): Promise<void> {
    return Promise.resolve();
  }

  private cloneState<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private cloneVideoAsset(asset: VideoAsset): VideoAsset {
    return {
      ...asset,
      sourceSegments: this.cloneVideoAssetSegments(asset.sourceSegments),
      translatedSegments: this.cloneVideoAssetSegments(
        asset.translatedSegments,
      ),
      summarySections: this.cloneVideoAssetSummarySections(
        asset.summarySections,
      ),
    };
  }

  private cloneVideoAssetSegments(
    segments: VideoAsset['sourceSegments'],
  ): VideoAsset['sourceSegments'] {
    return segments.map((segment) => ({ ...segment }));
  }

  private cloneVideoAssetSummarySections(
    sections: VideoAsset['summarySections'],
  ): VideoAsset['summarySections'] {
    return sections.map((section) => ({ ...section }));
  }

  private idle(): Promise<void> {
    return Promise.resolve();
  }
}
