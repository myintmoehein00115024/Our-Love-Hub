(() => {
  "use strict";

  const LOVE_START_DATE = "2024-03-23";
  const START_DATE = new Date(2024, 2, 23);
  const UNLOCK_KEY = "thinthin_story_unlocked_at";
  const SEEN_KEY = "thinthin_story_seen";
  const counter = document.getElementById("runtime_span");

  function updateRuntime() {
    if (!counter) return;

    const now = new Date();
    const current = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let years = current.getFullYear() - START_DATE.getFullYear();
    let anchor = new Date(START_DATE.getFullYear() + years, START_DATE.getMonth(), START_DATE.getDate());
    if (anchor > current) {
      years--;
      anchor = new Date(START_DATE.getFullYear() + years, START_DATE.getMonth(), START_DATE.getDate());
    }

    let months = current.getMonth() - anchor.getMonth();
    if (months < 0) months += 12;

    let monthAnchor = new Date(anchor.getFullYear(), anchor.getMonth() + months, anchor.getDate());
    if (monthAnchor > current) {
      months--;
      monthAnchor = new Date(anchor.getFullYear(), anchor.getMonth() + months, anchor.getDate());
    }

    const days = Math.round((
      Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()) -
      Date.UTC(monthAnchor.getFullYear(), monthAnchor.getMonth(), monthAnchor.getDate())
    ) / 86400000);

    const yearLabel = years === 1 ? "Year" : "Years";
    const monthLabel = months === 1 ? "Month" : "Months";
    const dayLabel = days === 1 ? "Day" : "Days";

    counter.textContent = `We're In Love · ${years} ${yearLabel} · ${months} ${monthLabel} · ${days} ${dayLabel}`;
  }

  function rememberStory() {
    try {
      const now = String(Date.now());
      localStorage.setItem(UNLOCK_KEY, now);
      sessionStorage.setItem(UNLOCK_KEY, now);
      localStorage.setItem(SEEN_KEY, "1");
      sessionStorage.setItem(SEEN_KEY, "1");
      sessionStorage.setItem("thinthin_story_unlocked", LOVE_START_DATE);
    } catch (error) {}
  }

  function syncUnlockBeforeNavigate() {
    if (!document.documentElement.classList.contains("story-unlocked")) return;
    rememberStory();
  }

  document.querySelectorAll('a[href="./message/index.html"], a[href="./Love/love.html"], a[href="./heartbeat/index.html"]').forEach((link) => {
    link.addEventListener("click", syncUnlockBeforeNavigate, { capture: true });
  });

  const intro = document.getElementById("love-intro");
  const enterLove = document.getElementById("enter-love");

  function openStory(immediate = false) {
    if (!intro) return;
    intro.classList.add("is-hidden");
    document.body.classList.remove("intro-locked");
    document.documentElement.classList.add("story-unlocked");
    if (immediate) {
      intro.remove();
    } else {
      window.setTimeout(() => intro.remove(), 650);
    }
  }

  function hasSeenStory() {
    try {
      return localStorage.getItem(SEEN_KEY) === "1" || sessionStorage.getItem(SEEN_KEY) === "1";
    } catch (error) {
      try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch (_) { return false; }
    }
  }

  if (intro && enterLove) {
    if (hasSeenStory()) {
      rememberStory();
      openStory(true);
    } else {
      enterLove.addEventListener("click", () => {
        rememberStory();
        openStory(false);
      });
    }
  }

  updateRuntime();
  window.setInterval(updateRuntime, 60000);
})();
