import { useCallback, useEffect, useState } from "react"
import {
  forceDeleteReview,
  forceDeleteComment,
  getAuditLogs,
  getReports,
  hideComment,
  hideReview,
  restoreComment,
  restoreReview,
  type AuditLog,
  type ReviewReport,
} from "./api"
import "./admin-page.css"

export default function AdminPage() {
  const [reports, setReports] = useState<ReviewReport[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [status, setStatus] = useState("OPEN")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const loadAdminData = useCallback(async () => {
    try {
      const [nextReports, nextAuditLogs] = await Promise.all([getReports(status), getAuditLogs()])
      setError("")
      setReports(nextReports)
      setAuditLogs(nextAuditLogs)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data.")
    }
  }, [status])

  useEffect(() => {
    void Promise.resolve().then(() => loadAdminData())
  }, [loadAdminData])

  async function runModeration(action: () => Promise<unknown>, successMessage: string) {
    try {
      setError("")
      setMessage("")
      await action()
      setMessage(successMessage)
      await loadAdminData()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moderation action failed.")
    }
  }

  function hideReportedTarget(report: ReviewReport) {
    return report.targetType === "Comment"
      ? hideComment(report.targetId, report.reason)
      : hideReview(report.targetId, report.reason)
  }

  function restoreReportedTarget(report: ReviewReport) {
    return report.targetType === "Comment"
      ? restoreComment(report.targetId)
      : restoreReview(report.targetId)
  }

  function forceDeleteReportedTarget(report: ReviewReport) {
    return report.targetType === "Comment"
      ? forceDeleteComment(report.targetId)
      : forceDeleteReview(report.targetId)
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p>OPERATIONS</p>
          <h1>Admin moderation</h1>
        </div>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="OPEN">Open reports</option>
          <option value="ALL">All reports</option>
        </select>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}
      {error ? <p className="admin-message admin-message--error">{error}</p> : null}

      <section className="admin-section">
        <h2>Reports</h2>
        <div className="admin-table">
          <div className="admin-row admin-row--head">
            <span>Report</span>
            <span>Target</span>
            <span>Reason</span>
            <span>Actions</span>
          </div>
          {reports.map((report) => (
            <div className="admin-row" key={report.id}>
              <span>#{report.id}</span>
              <span>
                {report.targetType} #{report.targetId}
              </span>
              <span>{report.detail ? `${report.reason}: ${report.detail}` : report.reason}</span>
              <span className="admin-actions">
                <button
                  type="button"
                  onClick={() =>
                    runModeration(
                      () => hideReportedTarget(report),
                      "Target hidden.",
                    )
                  }
                >
                  Hide
                </button>
                <button
                  type="button"
                  onClick={() =>
                    runModeration(() => restoreReportedTarget(report), "Target restored.")
                  }
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Force delete this target?")) {
                      void runModeration(
                        () => forceDeleteReportedTarget(report),
                        "Target force deleted.",
                      )
                    }
                  }}
                >
                  Force delete
                </button>
              </span>
            </div>
          ))}
          {reports.length === 0 ? <p className="admin-empty">No reports.</p> : null}
        </div>
      </section>

      <section className="admin-section">
        <h2>Audit logs</h2>
        <div className="admin-table">
          <div className="admin-row admin-row--head">
            <span>Time</span>
            <span>Actor</span>
            <span>Action</span>
            <span>Target</span>
          </div>
          {auditLogs.map((log) => (
            <div className="admin-row" key={log.id}>
              <span>{new Date(log.createdAt).toLocaleString()}</span>
              <span>#{log.actorId}</span>
              <span>{log.action}</span>
              <span>
                {log.targetType} #{log.targetId}
              </span>
            </div>
          ))}
          {auditLogs.length === 0 ? <p className="admin-empty">No audit logs.</p> : null}
        </div>
      </section>
    </main>
  )
}
