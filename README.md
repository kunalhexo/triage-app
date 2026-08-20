# Triage — the interface

A small web app that shows what the routines found, lets you correct it, and
records what you want done. Runs on Vercel. No AI calls, no token limits.

## How it fits together

```
Routines (Claude, in the cloud)  ->  Linear "Triage" team  <->  this app
     1A collect                          the database          what you see
     1B triage                                                 and click
     2  execute
     4  learn
```

**This app never decides anything.** It reads Linear over the normal API and
writes back your choices as labels and comments. Every judgment stays in the
routines, and every rule stays in the Notion Learning Store.

That is also why it is reliable. The old artifact asked a language model to
fetch and filter lists, and the replies kept getting cut off. Reading a
database is not a job for a model.

## What each click does

| You click | It writes to Linear | What happens next |
|---|---|---|
| An option (1, 2, 3) | `EXEC: 1` comment | Routine 2 sends the email or message |
| A bucket on a drop or unsure | Swaps the labels, adds a FEEDBACK comment | Routine 4 learns from it that night |
| Approve on a proposal | FEEDBACK comment, moves to In Review | Routine 4 promotes the rule that night |
| Save note | `FEEDBACK: <your words>` comment | Routine 4 turns it into a rule |

Your words are stored exactly as typed. Nothing rephrases them.

---

## Setting it up

Roughly twenty minutes. No terminal needed.

### 1. Get your Linear API key

1. Open Linear.
2. Click your workspace name, top left, then **Settings**.
3. In the left sidebar, click **Security & access**.
4. Find **Personal API keys** and click **New API key**.
5. Label it `Triage app`. Click **Create**.
6. **Copy the key now** — it starts with `lin_api_` and Linear will not show
   it again. Paste it somewhere safe for the next few minutes.

### 2. Put the code on GitHub

1. Go to https://github.com/new
2. Repository name: `triage-app`. Choose **Private**. Click **Create
   repository**.
3. On the next screen click **uploading an existing file**.
4. Drag in every file and folder from this project, keeping the folder
   structure. The `app` and `lib` folders must stay as folders.
5. Click **Commit changes**.

### 3. Deploy on Vercel

1. Go to https://vercel.com and sign in with GitHub.
2. Click **Add New** then **Project**.
3. Find `triage-app` in the list and click **Import**.
4. Before clicking Deploy, open **Environment Variables** and add these two:

   | Name | Value |
   |---|---|
   | `LINEAR_API_KEY` | the `lin_api_...` key from step 1 |
   | `LINEAR_TEAM_KEY` | `TRI` |

5. Click **Deploy**. It takes about a minute.
6. When it finishes, click the preview image to open your app.

You now have a URL like `triage-app-xxxx.vercel.app`. Add it to your phone
home screen and it behaves like an app.

### 4. Lock it down

By default anyone with the URL can open it. Fix that in Vercel:

1. Open the project, go to **Settings**, then **Deployment Protection**.
2. Turn on **Vercel Authentication**.

Now only your Vercel account can open it.

### 5. Optional — make actions run instantly

Without this, clicking an option records your choice and Routine 2 carries it
out on its next run, so up to an hour. With it, the click wakes the routine
straight away.

1. Open your **2 Execute** routine at claude.ai/code/routines.
2. Find its API trigger — an endpoint URL and a token.
3. In Vercel, go to **Settings** then **Environment Variables** and add
   `ROUTINE_TRIGGER_URL` and `ROUTINE_TRIGGER_TOKEN`.
4. Go to **Deployments**, click the most recent one, and choose **Redeploy**.

The app works fine without this. Add it once everything else is running.

---

## When something looks wrong

**"LINEAR_API_KEY is not set"** — the variable is missing in Vercel, or you
added it after deploying. Add it, then redeploy from the Deployments tab.

**"No Linear team with key TRI"** — check `LINEAR_TEAM_KEY` matches your team
prefix exactly. It is case sensitive.

**A tab shows nothing** — that is real. The app reads Linear directly, so an
empty tab means no issues carry that label. Check in Linear itself.

**A click reports an error** — nothing was changed. Linear writes either
succeed or fail whole; there is no half-written state.

## Changing it

Everything visible lives in `app/page.js`. Colours are at the top, the tabs
just below. Edit the file on GitHub and Vercel redeploys within a minute.

The one rule worth keeping: **no decision logic in this app.** If you find
yourself adding a rule about which items matter, that rule belongs in the
Notion Learning Store, where corrections can change it. This app renders and
records — nothing else.
