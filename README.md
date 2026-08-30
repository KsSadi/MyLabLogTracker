# MyLabLogTracker (My Codelab Dashboard)

A premium, feature-rich developer utility and time-tracking single-page application (SPA) designed to integrate seamlessly with your Codelab instance . It features automated log generation from Git commits, real-time workload estimation, an AI assistant, and auto-refresh mechanisms.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) installed on your machine.

### Running the Application

#### Option 1: Using the Batch script (Windows)
Double-click the [`MyCodelab.bat`](MyCodelab.bat) script in the root directory. This will:
1. Start the Node.js backend server.
2. Launch your default browser navigating to `http://localhost:5500/dashboard`.

#### Option 2: Running via Terminal
1. Open your terminal in the project directory.
2. Start the server:
   ```bash
   node server.js
   ```
3. Open your browser and navigate to `http://localhost:5500/dashboard`.

---

## ⚙️ Configuration Setup

On first launch, you will be prompted to open the **Settings** panel. Configure the following properties to unlock full functionality:

| Setting Key | Description | Default / Example |
| :--- | :--- | :--- |
| **GitLab URL** | The base URL of your GitLab instance. | `https://codelab.ba-systems.com` |
| **Personal Access Token (PAT)** | GitLab Personal Access Token with `api` permissions. | `glpat-xxxxxxxxxxxx` |
| **Saturday Work Hours** | Target work hours required on active Saturdays. | `7` |
| **Weekday Work Hours** | Target work hours required on normal weekdays. | `8` |
| **AI Provider** | Choose between `Gemini` or `Groq` to power the AI Assistant. | `Gemini` |
| **Gemini API Key** | Google AI Studio API Key. Required if Gemini is selected. | `AIzaSy...` |
| **Gemini Model** | Target model for text generation. | `gemini-2.5-flash-lite` |
| **Groq API Key** | Groq Console API Key. Required if Groq is selected. | `gsk_...` |
| **Groq Model** | Target model for Groq text generation. | `llama-3.3-70b-versatile` |
| **Discord Webhook** | Discord Webhook URL for posting log summaries and status alerts. | `https://discord.com/api/webhooks/...` |
| **Git Identities** | Comma-separated Git usernames or emails to match commit authors. | `mdsadi.ossp@gmail.com, Sadi` |

*Note: Saturday off days (holidays/weekends) can be customized directly on the Time Report / Monthly Log interface by clicking on the dates.*

---

## 📖 User Guide

### 1. Dashboard (`/dashboard`)
*   **Greeting & Progress**: Dynamic greeting based on time of day and status.
*   **Issues Overview**: Quickly inspect open, closed, or active GitLab issues assigned to you.
*   **Status Ring Indicator**: Located in the header, a circular progress bar visualizes the background sync cycle (3-minute interval). It fills smoothly and turns yellow while active.

### 2. Issues (`/issues`)
*   Search, filter, and view GitLab issues assigned directly to you.
*   Start tracking time or edit issue comments directly from the lists.

### 3. Summary (`/summary`)
*   Aggregates your daily or weekly logged times.
*   Displays remaining hours to satisfy target hour configurations.

### 4. Log Entry & Issue Creation (`/create`, `/log`)
*   **Quick Create (`n`)**: Spawn new GitLab issues directly from the dashboard.
*   **Quick Log (`l`)**: Record time logs/worklogs on specific GitLab issues.
*   Draft logs manually or use Git activity to auto-fill work logs.

### 5. Time Report (`/time`)
*   Provides a calendar layout showing total hours worked per day.
*   Accounts for public holidays (synced from `holidays.json` for Bangladesh) and weekends.
*   Click on Saturdays to toggle them between working days and weekends (Saturdays Off).

### 6. My Activity (`/activity`)
*   Lists recent Git activities and commit histories matched against your configured Git Identities.
*   Provides an automated base for generating daily developer logs.

### 7. Crafty AI Assistant (`/assistant`)
*   Integrated chatbot chat window using your configured AI Provider (Gemini or Groq).
*   Helps compile daily logs, summarize commits, or answer general developer questions.

---

## ⌨️ Keyboard Shortcuts

Save time with global hotkeys (available when not focusing an input, textarea, or select element):

| Hotkey | Action |
| :---: | :--- |
| <kbd>N</kbd> / <kbd>n</kbd> | Open **Quick Create Issue** Modal |
| <kbd>L</kbd> / <kbd>l</kbd> | Open **Quick Log Time** Modal |
| <kbd>S</kbd> / <kbd>s</kbd> | Open **Settings** Modal |
| <kbd>Escape</kbd> | Close any open modal overlay |
| **Triple Tap/Click Logo** | Open Settings Modal (Alternative gesture) |
