import { Link } from 'react-router-dom'
import { money } from '../api'

export const TIER_NAMES = { 1: 'Basic', 2: 'Pro', 3: 'Premium' }

export default function CourseCard({ course: c }) {
  return (
    <Link to={`/courses/${c.id}`} className="card course-card">
      <div className="thumb" style={{ background: `linear-gradient(135deg, ${c.color}, ${c.color}99)` }}>
        <span>{c.emoji}</span>
        <em className="tier-badge">{TIER_NAMES[c.tier]} plan</em>
      </div>
      <div className="card-body">
        <div className="tags"><span className="tag">{c.category}</span><span className="tag tag-light">{c.level}</span></div>
        <h3>{c.title}</h3>
        <p className="muted small">{c.instructor}</p>
        <div className="row between small">
          <span>⭐ {Number(c.rating).toFixed(1)} <span className="muted">({c.students.toLocaleString()})</span></span>
          <span className="muted">{c.hours}h · {c.lesson_count} lessons</span>
        </div>
        <div className="price">{money(c.price)}</div>
      </div>
    </Link>
  )
}
