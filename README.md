# Amazon Keyword Assistant v2

A local dashboard that opens a separate visible Chrome window, searches Amazon.in for keywords, matches target product listings by starting title text, clicks/opens them, waits for 20 seconds (with smooth scrolling), and automatically cycles through all keywords. Supports pasted keywords or Excel import.

## Setup

1. Install Node.js from https://nodejs.org if not already installed.
2. Open terminal in the `amazon-keyword-assistant` folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the dashboard:
   ```bash
   npm start
   ```
5. Open `http://localhost:3000` in your browser.

## Excel format

Put **Keyword** in column A and **Target Title Prefix** (optional) in column B. If column B is blank, the bot will search for the keyword and open the first organic search result.
