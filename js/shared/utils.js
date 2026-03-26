export function formatCurrency(amount) {
  return new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0
  }).format(Number(amount || 0));
}

export function formatDateTime(value) {
  if (!value) {
    return "Not yet";
  }
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function debounce(fn, wait = 250) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}

export function playTone(kind = "default") {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.connect(gain);
  gain.connect(context.destination);

  const profile =
    kind === "urgent"
      ? { frequency: 880, duration: 0.3, peak: 0.08 }
      : { frequency: 620, duration: 0.18, peak: 0.05 };

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(profile.frequency, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(profile.peak, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + profile.duration);
  oscillator.start();
  oscillator.stop(context.currentTime + profile.duration);
}

export function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

export function showBanner(element, message, tone = "neutral") {
  if (!element) {
    return;
  }
  element.textContent = message;
  element.dataset.tone = tone;
}

export function createSocket() {
  if (!window.io) {
    return null;
  }
  return window.io({
    transports: ["websocket", "polling"]
  });
}
