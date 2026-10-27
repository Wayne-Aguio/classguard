# ClassGuard REST API

Base URL: `http://localhost:3000/api` · JSON in, JSON out (except CSV and the data export).

**Authentication.** Sign in to get a token, then send it on every other call:

```
Authorization: Bearer <token>
```

Tokens last 7 days. All timestamps are Unix milliseconds. Errors look like:

```json
{ "error": "not_found", "message": "Class not found." }
```

| Status | Meaning |
|---|---|
| 400 | Invalid input |
| 401 | Missing, invalid or expired token / wrong password |
| 403 | Wrong role, or `consent_required` |
| 404 | Not found (also used when the resource belongs to someone else) |
| 409 | Conflict (for example email already used) |
| 429 | Too many login attempts |

---

## Auth and account

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/register` | public | Body `{name, email, password (8+), role: "teacher"\|"student", invite_code?}` → `201 {token, user}` |
| POST | `/auth/login` | public | Body `{email, password}` → `{token, user, consents}` |
| GET | `/me` | any | `{user, consents, consent_version}` |
| PUT | `/me/consents` | student | Body `{scope: "attendance"\|"exam", granted: boolean}` |
| GET | `/me/export` | any | Download all of the user's own data as JSON |
| DELETE | `/me` | any | Body `{password}`. Deletes the account and all its data |

`consents` looks like `{attendance: {granted, version, at} | null, exam: … }` (`null` = never answered).

## Student

| Method | Path | Description |
|---|---|---|
| GET | `/student/classes` | Classes the student has joined, with live state |
| POST | `/student/classes/join` | Body `{join_code}` |
| DELETE | `/student/classes/:id` | Leave a class |

## Teacher: classes and attendance

| Method | Path | Description |
|---|---|---|
| GET | `/classes` | Own classes with student, session and exam counts |
| POST | `/classes` | Body `{name, meet}` where `meet` is a Meet link or code |
| PATCH | `/classes/:id` | Body `{name?, meet?}` |
| DELETE | `/classes/:id` | Delete the class and all its data |
| DELETE | `/classes/:id/students/:studentId` | Remove a student |
| GET | `/classes/:id/live` | Roster for the open session (or the latest one) |
| GET | `/classes/:id/sessions` | Past sessions with attendance and average focus |
| GET | `/classes/:id/sessions/:sessionId` | Roster for one session |
| POST | `/classes/:id/sessions/end` | End the live session |
| GET | `/classes/:id/report.csv` | CSV for all sessions, or `?session=ID` for one |

Roster response (`/live` and `/sessions/:id`):

```json
{
  "class": {"id": 1, "name": "Grade 10 Physics", "meet_code": "abc-defg-hij", "join_code": "PHYS10"},
  "session": {"id": 4, "started_at": 1790000000000, "ended_at": null},
  "live": true,
  "summary": {"enrolled": 8, "in_meeting": 5, "focused": 4, "away": 1, "left": 1, "attended": 6,
              "absent": 1, "no_consent": 1, "avg_focus_pct": 82},
  "students": [{
    "id": 12, "name": "Ana Santos", "email": "ana@demo.test",
    "status": "focused",            // focused | away | left | attended | absent | no_consent
    "present_ms": 1800000, "focus_ms": 1700000, "focus_pct": 94,
    "joins": 2, "rejoins": 1, "first_join": 1790000100000, "last_leave": null, "last_seen_at": 1790001900000,
    "history": [{"kind": "join", "reason": "heartbeat", "at": 1790000100000}],
    "segments": [{"from": 1790000100000, "to": 1790000400000, "state": "focused"}]  // focused | away | out
  }]
}
```

## Teacher: exams

| Method | Path | Description |
|---|---|---|
| GET | `/exams` | Own exams with attempt, high-risk and to-review counts |
| POST | `/exams` | Body `{class_id, title, url}`. Google Forms or Microsoft Forms link (`?id=`) |
| PATCH | `/exams/:id` | Body `{title?, is_open?}` |
| DELETE | `/exams/:id` | Delete exam and attempts |
| GET | `/exams/:id/attempts` | Every student in the class with state, counts, risk score and review status, plus the score weights |
| GET | `/exams/:id/attempts/:attemptId` | `{attempt, events, assessment}` where `assessment` explains the score |
| PATCH | `/exams/:id/attempts/:attemptId` | Body `{review_status: "pending"\|"cleared"\|"flagged", review_note?}` |
| GET | `/exams/:id/report.csv` | CSV of all attempts |

Attempt `state`: `not_started`, `in_progress`, `ended`, `no_consent`. `risk_level`: `low`, `medium`, `high`.

## Extension (student token)

These are called by the extension. They return `403 {"error":"consent_required","scope":…}` if the student has not allowed that kind of monitoring.

| Method | Path | Description |
|---|---|---|
| GET | `/ext/status` | `{user, consents, classes}` |
| POST | `/ext/presence` | Body `{meet_code, focused: boolean, leaving?: boolean}`. Send every ~15 s and on change. Returns `{ok, class, state}` or `404 no_class` |
| POST | `/ext/exam/match` | Body `{url}` → `{match: false}` or `{match: true, exam: {id, title}, consent}` |
| POST | `/ext/exam/events` | Body `{exam_id, events: [{type, at, duration_ms?}]}`. Types: `tab_switch`, `tab_return`, `window_blur`, `copy`, `paste`, `cut`. An empty list starts the attempt. Max 200 events per call |
| POST | `/ext/exam/finish` | Body `{exam_id}` |

## Other

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{ok: true}` |

## Example

```bash
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"teacher@demo.test","password":"teacher123"}' | jq -r .token)

curl -s localhost:3000/api/classes/1/live -H "Authorization: Bearer $TOKEN" | jq .summary
curl -s localhost:3000/api/classes/1/report.csv -H "Authorization: Bearer $TOKEN" -o attendance.csv
```
