import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext.jsx'

export default function MyLearning() {
  const { user } = useAuth()
  const [d, setD] = useState(null)
  const [sub, setSub] = useState(undefined)
  useEffect(() => {
    api('/my/courses').then(setD)
    api('/subscription').then((r) => setSub(r.subscription))
  }, [])

  if (!d) return <div className="container page"><p className="muted">Loading…</p></div>
  const { courses, stats } = d
  const lockedCount = courses.filter((c) => c.locked).length

  return (
    <div className="container page">
      <h1>Welcome back, {user.name.split(' ')[0]} 👋</h1>
      <div className="statrow">
        <div className="card stat"><b>{stats.enrolled}</b><span>Enrolled courses</span></div>
        <div className="card stat"><b>{stats.lessonsDone}</b><span>Lessons completed</span></div>
        <div className="card stat"><b>{stats.completed}</b><span>Courses completed</span></div>
        <div className="card stat"><b>{sub?.status === 'active' ? sub.plan_name : 'None'}</b><span>{sub?.status === 'active' ? 'Current plan' : 'Subscription'}</span></div>
      </div>
      {lockedCount > 0 && <div className="alert alert-warn">{lockedCount} course(s) are locked because your plan changed or expired. <Link to="/account">Manage subscription</Link></div>}
      <h2>My courses</h2>
      {courses.length === 0 ? (
        <div className="card empty">
          <p>You haven't enrolled in anything yet.</p>
          <Link to="/courses" className="btn btn-primary">Browse courses</Link>
        </div>
      ) : (
        <div className="grid">
          {courses.map((c) => (
            <div key={c.id} className="card course-card">
              <div className="thumb" style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}99)` }}><span>{c.emoji}</span>{c.locked && <em className="tier-badge">🔒 Locked</em>}</div>
              <div className="card-body">
                <h3>{c.title}</h3>
                <p className="muted small">{c.source === 'purchase' ? 'Purchased' : 'Via subscription'} · {c.completed_count}/{c.lesson_count} lessons</p>
                <div className="bar"><div style={{ width: `${c.percent}%` }} /></div>
                <div className="row between small"><span>{c.percent}% complete</span></div>
                {c.locked
                  ? <Link className="btn btn-outline btn-block" to={`/courses/${c.id}`}>Unlock</Link>
                  : <Link className="btn btn-primary btn-block" to={`/learn/${c.id}`}>{c.percent === 0 ? 'Start' : c.percent === 100 ? 'Review' : 'Continue'}</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
