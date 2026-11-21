import { tx, one } from './db.js';

const plans = [
  ['Basic', 1, 9, 90, 'Start learning with our foundational catalog.',
    ['Access to all Basic-tier courses', 'Learn on any device', 'Progress tracking']],
  ['Pro', 2, 19, 190, 'Unlock intermediate courses and career paths.',
    ['Everything in Basic', 'All Pro-tier courses', 'Downloadable resources', 'Certificates of completion']],
  ['Premium', 3, 29, 290, 'The entire catalog, including advanced specializations.',
    ['Everything in Pro', 'All Premium-tier courses', 'Mentor Q&A', 'Priority support']],
];

// title, category, level, instructor, description, price, hours, rating, students, tier, emoji, color, lessons[]
const courses = [
  ['Python for Everybody', 'Programming', 'Beginner', 'Dr. Ananya Rao', 'Learn Python from scratch: variables, control flow, functions, files and data structures with hands-on exercises.', 49, 18, 4.8, 12840, 1, '🐍', '#3b82f6', ['Setting up Python', 'Variables and types', 'Conditionals and loops', 'Functions', 'Lists and dictionaries', 'Working with files']],
  ['JavaScript: The Complete Guide', 'Programming', 'Beginner', 'Marcus Lee', 'Master modern JavaScript (ES6+), the DOM, async programming and tooling.', 59, 24, 4.7, 9320, 1, '🟨', '#f59e0b', ['JS fundamentals', 'Functions and scope', 'The DOM', 'Promises and async/await', 'Modules and tooling']],
  ['Full-Stack Web Development', 'Web Development', 'Intermediate', 'Priya Nair', 'Build and deploy production-style apps with React, Node.js, Express and SQL.', 89, 40, 4.9, 7410, 2, '🌐', '#10b981', ['Project architecture', 'React components and state', 'REST APIs with Express', 'Databases and SQL', 'Authentication', 'Deployment']],
  ['Data Analysis with SQL', 'Data Science', 'Beginner', 'Rohan Mehta', 'Query, join and aggregate data like an analyst using real-world datasets.', 39, 12, 4.6, 6150, 1, '🗄️', '#06b6d4', ['SELECT basics', 'Filtering and sorting', 'Joins', 'Aggregations and GROUP BY', 'Window functions']],
  ['Machine Learning A-Z', 'Data Science', 'Intermediate', 'Dr. Sofia Alvarez', 'From regression to neural networks: build, evaluate and tune ML models in Python.', 99, 36, 4.8, 8830, 2, '🤖', '#8b5cf6', ['ML overview', 'Linear regression', 'Classification', 'Model evaluation', 'Trees and ensembles', 'Intro to neural networks']],
  ['Deep Learning Specialization', 'Data Science', 'Advanced', 'Dr. Kenji Watanabe', 'CNNs, RNNs, transformers and modern training techniques with practical projects.', 129, 52, 4.9, 4210, 3, '🧠', '#ec4899', ['Neural network foundations', 'Optimization', 'Convolutional networks', 'Sequence models', 'Transformers', 'Capstone project']],
  ['UI/UX Design Essentials', 'Design', 'Beginner', 'Isabella Rossi', 'Learn design thinking, wireframing, prototyping and usability testing.', 45, 14, 4.7, 5560, 1, '🎨', '#f43f5e', ['Design thinking', 'User research', 'Wireframes', 'Prototyping', 'Usability testing']],
  ['Digital Marketing Masterclass', 'Business', 'Beginner', 'Aarav Kapoor', 'SEO, content, paid ads and analytics to grow any brand online.', 49, 16, 4.5, 7020, 1, '📈', '#f97316', ['Marketing funnel', 'SEO fundamentals', 'Content strategy', 'Paid advertising', 'Analytics and reporting']],
  ['Product Management Bootcamp', 'Business', 'Intermediate', 'Hannah Schmidt', 'Discovery, roadmapping, prioritization and shipping products people love.', 79, 22, 4.7, 3980, 2, '🧭', '#14b8a6', ['What PMs do', 'Customer discovery', 'Prioritization frameworks', 'Roadmaps', 'Metrics and experiments']],
  ['Cloud Computing with AWS', 'Cloud & DevOps', 'Intermediate', 'Vikram Singh', 'Core AWS services: compute, storage, networking, IAM and cost optimization.', 89, 28, 4.6, 5290, 2, '☁️', '#0ea5e9', ['Cloud concepts', 'EC2 and compute', 'S3 and storage', 'VPC networking', 'IAM and security']],
  ['Docker & Kubernetes in Practice', 'Cloud & DevOps', 'Advanced', "Liam O'Connor", 'Containerize, orchestrate and scale applications with confidence.', 109, 26, 4.8, 3340, 3, '🐳', '#2563eb', ['Containers 101', 'Writing Dockerfiles', 'Kubernetes architecture', 'Deployments and services', 'Scaling and observability']],
  ['Cybersecurity Fundamentals', 'Security', 'Beginner', 'Nadia Hussain', 'Threats, cryptography, network defense and secure development basics.', 55, 15, 4.6, 4670, 1, '🛡️', '#64748b', ['Threat landscape', 'Cryptography basics', 'Network security', 'Secure coding', 'Incident response']],
  ['System Design for Engineers', 'Programming', 'Advanced', 'Arjun Desai', 'Design scalable, reliable systems: caching, sharding, queues and trade-offs.', 119, 20, 4.9, 3120, 3, '🏗️', '#a855f7', ['Requirements and estimation', 'Load balancing and caching', 'Databases at scale', 'Messaging and queues', 'Case studies']],
];

export async function seed() {
  if ((await one('SELECT COUNT(*)::int AS c FROM courses')).c > 0) return;
  await tx(async (c) => {
    for (const [n, r, m, y, d, f] of plans) {
      await c.query('INSERT INTO plans (name,rank,price_monthly,price_yearly,description,features) VALUES ($1,$2,$3,$4,$5,$6)',
        [n, r, m, y, d, JSON.stringify(f)]);
    }
    for (const [title, cat, lvl, ins, desc, price, hrs, rat, st, tier, emoji, color, lessons] of courses) {
      const { rows } = await c.query(
        'INSERT INTO courses (title,category,level,instructor,description,price,hours,rating,students,tier,emoji,color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
        [title, cat, lvl, ins, desc, price, hrs, rat, st, tier, emoji, color]);
      const id = rows[0].id;
      for (let i = 0; i < lessons.length; i++) {
        const lt = lessons[i];
        await c.query('INSERT INTO lessons (course_id,position,title,minutes,content) VALUES ($1,$2,$3,$4,$5)', [id, i + 1, lt, 8 + ((i * 7) % 15),
          `In this lesson of "${title}", ${ins} walks you through ${lt.toLowerCase()} step by step. ` +
          `You will see worked examples, common pitfalls, and finish with a short exercise to cement the idea.

` +
          `Key takeaways:
• Understand the core concept behind ${lt.toLowerCase()}
• Apply it in a small practical task
• Know where it fits in the bigger picture`]);
      }
    }
  });
}
