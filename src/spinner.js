// Tiny zero-dependency spinner. Draws on stderr so piped/redirected reports stay clean.

const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ASCII = ['-', '\\', '|', '/'];

// Old Windows consoles (cmd.exe, legacy PowerShell) draw braille as empty boxes.
function pickFrames() {
  const modern = process.platform !== 'win32' || process.env.WT_SESSION || process.env.TERM_PROGRAM;
  return modern ? BRAILLE : ASCII;
}

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE = '\r\x1b[K';

/**
 * @param {string} text  message shown next to the spinner
 * @param {object} opts  enabled (default: stream is a TTY), delay in ms before first draw, stream
 */
export function createSpinner(text, { stream = process.stderr, enabled, delay = 200, frames = pickFrames() } = {}) {
  const active = (enabled ?? true) && Boolean(stream.isTTY);
  const color = (s) => (process.env.NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`);
  let frame = 0;
  let interval = null;
  let timer = null;
  let drawn = false;

  const draw = () => {
    stream.write(`${CLEAR_LINE}${color(frames[frame++ % frames.length])} ${text}`);
  };
  const restoreCursor = () => stream.write(SHOW_CURSOR);

  return {
    start() {
      if (!active) return this;
      // Fast scans finish before the delay, so nothing ever flashes on screen.
      timer = setTimeout(() => {
        drawn = true;
        stream.write(HIDE_CURSOR);
        process.once('exit', restoreCursor); // Ctrl+C must not leave the cursor hidden
        draw();
        interval = setInterval(draw, 80);
      }, delay);
      return this;
    },
    update(newText) {
      text = newText;
    },
    stop() {
      clearTimeout(timer);
      clearInterval(interval);
      if (drawn) {
        stream.write(CLEAR_LINE);
        restoreCursor();
        process.removeListener('exit', restoreCursor);
        drawn = false;
      }
    },
  };
}