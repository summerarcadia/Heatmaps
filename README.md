# Hayley's Daily Accountability

A public log of my daily study habits, each with its own heatmap and streaks:

- **Anki**: review counts, uploaded automatically by my Anki add-on after each sync.
- **Jack Westin CARS**: goal of 1 passage a day.
- **UWorld**: goal of 10 questions done and reviewed a day.

## How it works

- `index.html`, `style.css` and `app.js` make up the page, served by GitHub Pages. They're plain HTML, CSS and JavaScript with no dependencies.
- `habits.json` lists the habits, their goals and color schemes, plus the page appearance (calendar mode and background). To add a habit, add an entry there and an empty `data/<name>.json` file.
- `data/*.json` holds the daily counts. A day starts at 4 a.m., matching Anki.
- To check in, I log in on the page with a GitHub token that can only write to this repo. The page then shows buttons that save each check-in as a commit. The token is stored only in my browser; visitors only see the heatmaps.
- When logged in, the Customize panel changes the calendar mode (Yearly Overview or Continuous Timeline), each habit's color scheme, and the page background (a color or an uploaded image, saved to `assets/background.jpg`).
- The page can be added to a phone's home screen and opens like an app.
