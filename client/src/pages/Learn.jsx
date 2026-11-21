import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'

export default function Learn() {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [cur, setCur] = useState(0)

  useEffect(() => {
    api(`/courses/${id}/learn`).then((r) => {
      setD(r)
      const firstOpen = r.lessons.findIndex((l) => !l.completed)
      setCur(firstOpen === -1 ? 0 : firstOpen)
    }).catch((e) => setError(e.message))
  }, [id])

  if (error) return (
    <div className="container page"><div className="alert alert-error">{error}</div>
      <Link className="btn btn-primary" to={`/courses/${id}`}>View course options</Link></div>
  )
  if (!d) return <div className="container page"><p className="muted">Loading…</p></div>

  const { course, lessons } = d
  const lesson = lessons[cur]
  const done = lessons.filter((l) => l.completed).length
  const percent = Math.round((done / lessons.length) * 100)

  async function toggle() {
    const next = !lesson.completed
    await api(`/lessons/${lesson.id}/complete`, { method: next ? 'POST' : 'DELETE' })
    setD({ ...d, lessons: lessons.map((l, i) => (i === cur ? { ...l, completed: next } : l)) })
    if (next && cur < lessons.length - 1) setCur(cur + 1)
  }

  return (
    <div className="container page learn">
      <aside className="card side">
        <Link to="/my-learning" className="small">← My learning</Link>
        <h3>{course.emoji} {course.title}</h3>
        <div className="bar"><div style={{ width: `${percent}%` }} /></div>
        <p className="muted small">{done}/{lessons.length} lessons · {percent}% complete</p>
        <ul className="lesson-list">
          {lessons.map((l, i) => (
            <li key={l.id}><button className={i === cur ? 'on' : ''} onClick={() => setCur(i)}>
              <span className={`dot ${l.completed ? 'done' : ''}`}>{l.completed ? '✓' : l.position}</span>
              <span>{l.title}<small>{l.minutes} min</small></span>
            </button></li>
          ))}
        </ul>
      </aside>
      <section className="card lesson">
        <p className="muted small">Lesson {lesson.position} of {lessons.length}</p>
        <h1>{lesson.title}</h1>
        <div className="video" style={{ background: `linear-gradient(135deg, ${course.color}, #1e1b4b)` }}>▶ <small>{lesson.minutes} min video (demo)</small></div>
        <p className="content">{lesson.content}</p>
        <div className="row gap">
          <button className="btn btn-outline" disabled={cur === 0} onClick={() => setCur(cur - 1)}>← Previous</button>
          <button className={`btn ${lesson.completed ? 'btn-outline' : 'btn-primary'} grow`} onClick={toggle}>
            {lesson.completed ? '✓ Completed (click to undo)' : cur < lessons.length - 1 ? 'Mark complete & continue' : 'Mark complete'}
          </button>
          <button className="btn btn-outline" disabled={cur === lessons.length - 1} onClick={() => setCur(cur + 1)}>Next →</button>
        </div>
        {percent === 100 && <div className="alert alert-ok">🎉 You've completed this course!</div>}
      </section>
    </div>
  )
}
