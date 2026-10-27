# ClassGuard

Attendance, attention and exam-integrity monitoring for online classes on **Google Meet** and exams on **Google Forms** or **Microsoft Forms**.

- **Live teacher dashboard**: every student's status (focused, tab in background, left, not joined), with join / leave / rejoin history and a timeline strip for the whole lesson.
- **Chrome extension (Manifest V3)**: reports only whether the class tab is in front. It does not read the mouse, keyboard or screen.
- **Exam module**: logs tab switches and copy / paste / cut *counts* and produces a risk score for teacher review.
- **Privacy by design**: consent prompts, minimal data, bcrypt-hashed passwords, data export, account deletion and automatic retention limits.
- **CSV reports** and a **documented REST API** ([docs/API.md](docs/API.md)) backed by **ten database tables**.

No build step. Node.js + SQLite on the server, plain JavaScript in the browser.

---

## 1. Quick start (5 minutes)

You need **Node.js 18 or newer** and **Chrome or Edge**.

```bash
cd classguard
npm install
npm run seed      # optional: demo teacher, 8 students, past sessions and an exam
npm start         # http://localhost:3000
```

Open <http://localhost:3000>.

**Try the demo:** sign in as `teacher@demo.test` / `teacher123`. Open **Grade 10 Physics** to see past sessions, then open a second terminal and run:

```bash
npm run simulate
```

Seven demo students now join, switch tabs, drop out and rejoin. The live dashboard updates every 5 seconds. Under **Exams** you can open *Unit 3 quiz* to see risk scores and review attempts.

Other demo logins: `ana@demo.test`, `ben@demo.test`, … with password `student123`.

To start with real data instead, skip `npm run seed` and register at the website. To reset, stop the server and delete the `data/` folder.

---

## 2. For teachers

1. **Register** as a *Teacher* and sign in.
2. **Classes → New class.** Enter a name and the class's Google Meet link (or code such as `abc-defg-hij`). Use a *permanent* Meet link so every lesson maps to the class.
3. Share the class **join code** (shown on the class page) with your students.
4. **During the lesson** open the class page. Each row shows:
   - **Status**: *Focused* (class tab in front), *Tab in background*, *Left*, *Not joined* or *No consent*.
   - **Session so far**: a strip from the start of the lesson. Green = tab in front, amber = tab in background, blank = not in the meeting.
   - First joined, rejoins, time in class and focus %.
   - Click a row for the full join / leave / rejoin history.
5. **Export CSV** on the class page, or per session under **Past sessions**.
6. **End session** is optional. A session also closes by itself 10 minutes after the last student leaves.

### Running an exam

1. **Exams → New exam**, choose the class, enter a title and paste the form link.
   - **Google Forms:** the full link ending in `/viewform` (not `forms.gle`).
   - **Microsoft Forms:** open the short link first, then copy the address that contains `?id=`.
2. Tell students to install the extension and open the exam as normal.
3. Watch attempts appear on the exam page. Rows are sorted by risk. Click one to see **why** it scored what it did, the event timeline, and to mark it **Cleared** or **Flagged** with a note.
4. **Close exam** when time is up, then **Export CSV**.

**How the risk score works** (`server/risk.js`): points add up to a maximum of 100.

| Signal | Points |
|---|---|
| Left the exam tab | 10 each |
| Clicked into another window (tab still visible) | 3 each |
| Copy / Paste / Cut | 5 / 8 / 4 each |
| Time away from the exam tab | 2 per minute, up to 20 |

Under 25 is **low**, 25 to 49 **medium**, 50 and above **high**. The score is a pointer for human review, not proof of cheating. Students may paste their own words or switch tabs for harmless reasons. Edit the numbers in `server/risk.js` to match your school's policy.

---

## 3. For students

1. **Register** as a *Student* and sign in.
2. **My classes → Join a class** with the code from your teacher.
3. **Install the extension** (one time):
   1. Open `chrome://extensions` and turn on **Developer mode**.
   2. Click **Load unpacked** and choose the `extension` folder.
   3. Click the ClassGuard icon, check the server address (`http://localhost:3000` by default, or your school's address) and sign in.
   4. Read the privacy choices and press **Save my choices**.
4. Open your Google Meet class as usual. A small **"ClassGuard: attendance on"** badge appears bottom-left.
5. On an exam page you will see a consent prompt the first time. A badge shows that monitoring is on.

You can change your choices any time in the extension popup or on the **Privacy** page, where you can also download or delete all your data.

---

## 4. How it works

```
 Chrome extension                       Server (Node + SQLite)               Teacher dashboard
 ┌────────────────────┐   HTTPS/JSON   ┌──────────────────────────┐         ┌───────────────────┐
 │ meet.js   (Meet)   │──heartbeat────▶│ /api/ext/presence        │         │ polls every 5 s   │
 │ exam.js   (Forms)  │──event counts─▶│ /api/ext/exam/events     │◀────────│ /api/classes/…    │
 │ background.js      │  (needs consent)│ risk score, sweeper      │         │ /api/exams/…      │
 └────────────────────┘                └──────────────────────────┘         └───────────────────┘
```

- **Attendance.** While a Meet tab is open the extension sends a heartbeat every 15 seconds and immediately when the tab goes to the front or back. "Front" means the tab is visible *and* its window has focus. The server turns this into events: the first heartbeat is a **join**, no heartbeat for 45 seconds is a **leave** (timestamped at the last heartbeat), and the next heartbeat after that is a **rejoin**. Two tabs of the same Meet count as one.
- **Exams.** The extension asks the server whether the current form is an open exam for one of the student's classes. If so (and consent is given) it batches tab switch, window blur, copy, paste and cut events and sends them every 10 seconds.
- **Consent is enforced twice.** The extension does nothing without it, and the server rejects data without a current consent record (`403 consent_required`).

### Database (ten tables)

| Table | Purpose |
|---|---|
| `users` | Teachers and students. Passwords are bcrypt hashes. |
| `classes` | A class, its Meet code and join code. |
| `enrollments` | Student ↔ class, plus live presence state. |
| `consents` | Append-only log of consent choices. |
| `class_sessions` | One live meeting of a class. |
| `attendance_events` | Join, leave and rejoin history. |
| `focus_events` | Class tab in front / background changes. |
| `exams` | An exam link (Google or Microsoft Forms). |
| `exam_attempts` | One student's attempt, risk score and review status. |
| `exam_events` | Tab switch, window blur, copy, paste and cut events (counts only). |

### Project layout

```
server/        Express app, SQLite schema (db.js), risk score, attendance maths, routes/
public/         Dashboard (index.html, css/style.css, js/app.js)
extension/      Chrome extension (manifest.json, background.js, meet.js, exam.js, popup.*)
scripts/        seed.js (demo data), simulate.js (fake live students)
docs/API.md     REST API reference
```

---

## 5. Privacy by design

| What | How |
|---|---|
| Consent | Asked in the extension popup and again on the exam page. Separate for attendance and exams. Revocable any time. Stored as a log with timestamp and version. |
| Minimal data | Only: tab in front or not, join / leave times, and for exams counts and durations. Never the screen, mouse, keyboard, camera, microphone, answers, clipboard content or other tabs. |
| Transparency | A visible badge on Meet and exam pages while monitoring is on. |
| Passwords | bcrypt hashes only. Login tokens are signed and expire after 7 days. Login attempts are rate limited. |
| Student rights | **Privacy → Download my data** and **Delete my account** remove everything. |
| Retention | Records older than `RETENTION_DAYS` (default 180) are deleted automatically. |
| No score for students | Students are never shown their own risk score. |

Check your school's policy and local law (for example GDPR or the Data Privacy Act) and tell students about monitoring *before* using it.

---

## 6. Configuration

Set environment variables before `npm start`, or copy `.env.example` to `.env` and run `node --env-file=.env server/index.js` (Node 20.6+).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Server port. |
| `SECRET` | auto-generated in `data/.secret` | Signs login tokens. |
| `TEACHER_INVITE_CODE` | *(none)* | If set, teacher sign-up requires this code. **Set it in production.** |
| `RETENTION_DAYS` | `180` | Delete data older than this. |
| `DB_FILE` | `data/classguard.db` | SQLite file location. |

---

## 7. Known limits and troubleshooting

- **Meet lobby and "You left the meeting" screens** keep the same URL, so by default the extension counts the student as present while the tab is on the meeting page. The popup has an experimental **in-call detection** option that checks for a "Leave call" button (English Meet only). Google can change Meet's page at any time, so test it with a real lesson before relying on it.
- **No badge on Meet?** Is the extension signed in? Is the Meet code the same as the class's code? Meets opened through a nickname or a Calendar link that redirects to the code URL are fine; custom nicknames are not matched.
- **"Not one of your classes"**: the student has not joined the class with the join code.
- **Exam not recognised**: the link in ClassGuard must match the form the student opens (see exam steps above). Closed exams are ignored.
- **Server on another computer?** Use its address in the extension popup. Use **HTTPS** for anything beyond local testing (put the server behind a reverse proxy such as Caddy or nginx). Chrome requires HTTPS for non-localhost addresses to be reliable.
- **Changing extension code:** after editing, press the reload icon on `chrome://extensions`.
- **Browser support:** Chrome and Edge. Other browsers need their own packaging.
- The extension can be removed by a student. Missing data in the dashboard is a signal to ask, not proof of anything.

## 8. Production notes

- Run behind HTTPS and set `SECRET` and `TEACHER_INVITE_CODE`.
- In `server/index.js`, limit the CORS `Access-Control-Allow-Origin` to your extension's origin (`chrome-extension://<id>`).
- Back up `data/classguard.db` (a single file).
- Publishing the extension in the Chrome Web Store needs a privacy policy that matches section 5.

## License

Use and adapt freely within your school.
