// Import HeadTTS (adjust path if your structure differs)
import { HeadTTS } from '../vendor/headtts/modules/headtts.mjs';

var SprayReader = function (container) {
  this.container = $(container);
  this.headtts = null;
  this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  this.audioSource = null; // To store the AudioBufferSourceNode for playback control
  this.ttsData = null; // To store { words: [], wtimes: [], wdurations: [], audioBuffer: null }
  this.displayTimeout = null; // Stores the setTimeout ID for word display scheduling
  this.rawInput = null; // Store the original text input for TTS
  this.playbackQueue = []; // Queue for handling multiple TTS chunks
  this.playbackInfo = null; // Stores timing info for the currently playing chunk
  this.wordIdx = 0;
  this.isRunning = false;
  this.isPaused = false;
  this.isLoading = false; // Tracks if TTS model is loading or synthesizing
  this.statusCallback = null; // Optional callback for UI status updates
  this.afterDoneCallback = null; // Callback after playback finishes naturally
  this.currentSpeed = 1.0; // Default speed

  // Start HeadTTS initialization immediately
  this._initHeadTTS();
};

SprayReader.prototype = {
  // Keep afterDoneCallback setter if needed externally
  // afterDoneCallback: null,
  // WPM properties removed
  // wpm: null,
  // msPerWord: null,
  // wordIdx: null, // Moved to constructor
  // input: null, // Replaced by rawInput
  // words: null, // Now part of ttsData
  // isRunning: false, // Moved to constructor
  // isPaused: false, // Moved to constructor
  // timers: [], // Removed

  // --- Initialization --- //
  _initHeadTTS: async function () {
    // Prevent re-initialization
    if (this.headtts || this.isLoading) return;

    this.isLoading = true;
    this._updateStatus("Initializing TTS Engine...");

    try {
      this.headtts = new HeadTTS({
        // Use local inference endpoints first
        endpoints: ["webgpu", "wasm"],
        // Provide our own audio context
        audioCtx: this.audioContext,
        // Default voice (can be changed later via setup)
        defaultVoice: "af_bella",
        defaultSpeed: 1,
        // --> Use sentence splitting (default)
        splitSentences: true,
        // Use the timestamped model required by HeadTTS
        model: "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped",
        // Optional: Explicitly set transformers.js URL if not using CDN
        // transformersModule: "path/to/transformers.min.js"
      });

      this._updateStatus("Connecting to TTS Service...");
      await this.headtts.connect();

      // Set up the message handler *once* after successful connection
      this.headtts.onmessage = this._handleTTSMessage.bind(this);
      this.headtts.onerror = (error) => {
        console.error("HeadTTS System Error Callback Triggered:", error);
        this._updateStatus(`TTS System Error: ${error.message || error}`);
        this.isLoading = false;
        // Maybe try to reconnect or disable TTS?
      };

      this.isLoading = false;
      this._updateStatus("TTS Ready.");

    } catch (error) {
      console.error("HeadTTS Initialization failed:", error);
      this._updateStatus(`TTS Init Error: ${error.message || error}`);
      this.headtts = null; // Ensure it's null on failure
      this.isLoading = false;
    }
  },

  // --- Status Update Helper --- //
  _updateStatus: function (status) {
    // console.log("Status:", status); // Log status to console
    if (typeof this.statusCallback === 'function') {
      // Update UI via callback
      this.statusCallback(status);
    }
  },

  // --- Input Handling --- //
  setInput: function (input) {
    this.stop(); // Stop any current activity before setting new input
    this.rawInput = input; // Store the raw text for TTS
    this.wordIdx = 0;
    this.playbackQueue = []; // Clear queue on new input
    this.ttsData = null; // Clear previous TTS data
    this.container.html('&nbsp;'); // Clear display immediately
    this._updateStatus(this.headtts ? "TTS Ready." : "Initializing TTS Engine..."); // Update status based on TTS state

    // Note: Original Markdown processing and word splitting removed.
    // HeadTTS will provide the words based on its synthesis.
    // If specific display formatting (like images) is needed beyond what
    // HeadTTS provides in its `words` array, adjustments are needed
    // in _displayWord or how `this.rawInput` is prepared.
  },

  // WPM setter removed
  // setWpm: function (wpm) { ... },

  // --- Playback Control --- //
  start: async function () {
    // Prevent starting if already running or loading
    if (this.isRunning || this.isLoading) {
      this._updateStatus(this.isLoading ? "Loading..." : "Already running.");
      return;
    }

    // Ensure HeadTTS is initialized (or try again)
    if (!this.headtts) {
      this._updateStatus("TTS not ready. Initializing...");
      await this._initHeadTTS();
      if (!this.headtts) {
        this._updateStatus("TTS Initialization Failed. Cannot start.");
        return; // Initialization failed, cannot proceed
      }
    }

    // --- Resume Paused Playback --- //
    if (this.isPaused && this.ttsData && this.ttsData.audioBuffer) {
      this.isPaused = false;
      this.isRunning = true;
      this._updateStatus("Resuming...");
      // Recreate AudioBufferSourceNode to resume
      this._playAudioAndScheduleWords(this.ttsData.audioBuffer, this.ttsData.words, this.ttsData.wtimes);
      return;
    }

    // --- Start New Synthesis --- //
    if (!this.rawInput || this.rawInput.trim().length === 0) {
      this._updateStatus("No input text provided.");
      return;
    }

    // Reset state for new synthesis
    this.stop(); // Ensure clean state before starting new synthesis
    this.isLoading = true;
    this.wordIdx = 0;
    this.playbackQueue = []; // Ensure queue is clear before new synthesis
    this.ttsData = null;
    this.container.html('&nbsp;'); // Clear display

    this._updateStatus("Synthesizing audio...");
    try {
      // Send the text to HeadTTS for synthesis.
      // The results (metadata + audio) will be handled by _handleTTSMessage.
      console.log("[SprayReader] Calling headtts.synthesize()..."); // Log before call
      this.headtts.synthesize({ input: this.rawInput });
      console.log("[SprayReader] headtts.synthesize() called (asynchronous). Waiting for messages..."); // Log after call

    } catch (error) {
      console.error("TTS Synthesis failed immediately (synchronous error):", error);
      this._updateStatus(`Synthesis Error: ${error.message || error}`);
      this.isLoading = false;
    }
  },

  stop: function () {
    const wasActive = this.isRunning || this.isPaused || this.isLoading;

    this.playbackQueue = []; // Clear queue on stop
    this.isRunning = false;
    this.isPaused = false;
    this.isLoading = false;
    // Keep wordIdx as is for potential resume, reset only on new input/explicit stop command purpose
    // this.wordIdx = 0; // Resetting here prevents pause/resume accurately

    clearTimeout(this.displayTimeout); // Stop word scheduling
    this.displayTimeout = null;

    if (this.audioSource) {
      try {
        this.audioSource.onended = null; // Prevent lingering onended calls
        this.audioSource.stop();
      } catch (e) {
        // Ignore errors if it was already stopped or couldn't stop
      }
      this.audioSource = null;
    }

    // Only update status and clear display if it was actually doing something
    if (wasActive) {
      this._updateStatus("Stopped.");
      // We might want to keep the last displayed word on stop?
      // Clear display only if needed: this.container.html('&nbsp;');
    }

    // Don't clear ttsData on stop, allow stop -> start to replay
    // To force re-synthesis on start after stop, clear here:
    this.ttsData = null; // Clear current buffer info too
    // this.rawInput = null; // If needed
  },

  pause: function () {
    if (!this.isRunning) {
      return; // Can't pause if not running
    }
    this._updateStatus("Paused.");
    this.isRunning = false;
    this.isPaused = true;

    clearTimeout(this.displayTimeout); // Stop word scheduling
    this.displayTimeout = null;

    if (this.audioSource) {
      try {
        // Detach the onended handler *before* stopping to prevent stop() logic from firing
        this.audioSource.onended = null;
        this.audioSource.stop(); // Stop audio playback
      } catch (e) {
        console.warn("Audio could not be stopped (might have already finished):", e);
      }
      // Discard the source. A new one will be created on resume.
      this.audioSource = null;
    }
    // Keep this.ttsData and this.wordIdx to allow resuming
    // Note: Pause does not clear the playbackQueue. Resume will continue the current chunk.
  },

  // --- Internal TTS Handling --- //
  _handleTTSMessage: function (message) {
    console.log("[SprayReader] _handleTTSMessage received:", message);

    if (message.type === 'audio' && message.data) {
      console.log("[SprayReader] Received 'audio' type message.");

      const audioData = message.data.audio;
      const words = message.data.words || [];
      const wtimes = message.data.wtimes || [];
      const wdurations = message.data.wdurations || []; // Keep durations if available

      if (!audioData || words.length === 0 || wtimes.length === 0) {
        console.error("[SprayReader] Error: 'audio' message missing essential data (audio, words, or wtimes).", message.data);
        this._updateStatus("TTS Error: Incomplete data.");
        // Don't set isLoading=false here, might be waiting for more messages
        return;
      }

      // Process the received chunk data (decode if necessary)
      const processChunk = (buffer) => {
        const chunkData = {
          audioBuffer: buffer,
          words: words,
          wtimes: wtimes,
          wdurations: wdurations
        };

        // Add to queue or play immediately
        if (this.isRunning || this.isPaused || this.playbackQueue.length > 0) {
          console.log("[SprayReader] Queuing TTS chunk.");
          this.playbackQueue.push(chunkData);
        } else {
          console.log("[SprayReader] Playing TTS chunk immediately.");
          this.isLoading = false; // Finished loading this chunk
          this.isRunning = true;
          this._updateStatus("Playing...");
          this.wordIdx = 0; // Reset word index for the new chunk
          this._playAudioAndScheduleWords(chunkData.audioBuffer, chunkData.words, chunkData.wtimes);
        }
      };

      // Check audio data type and process
      if (audioData instanceof AudioBuffer) {
        console.log("[SprayReader] Audio data is already an AudioBuffer. Processing chunk...");
        processChunk(audioData);
      } else if (audioData instanceof ArrayBuffer) {
        console.log("[SprayReader] Audio data is an ArrayBuffer. Decoding...");
        // Keep isLoading = true while decoding
        this._updateStatus("Decoding audio chunk...");
        this.audioContext.decodeAudioData(audioData, (buffer) => {
          console.log("[SprayReader] Audio chunk decoded successfully. Processing chunk...");
          processChunk(buffer);
        }, (error) => {
          console.error('[SprayReader] Error decoding audio data:', error);
          this._updateStatus(`Audio Decode Error: ${error.message || error}`);
          this.isLoading = false; // Stop loading on decode error
        });
      } else {
        console.error("[SprayReader] Error: Received audio data is neither AudioBuffer nor ArrayBuffer.", audioData);
        this._updateStatus("TTS Error: Invalid audio data format.");
        this.isLoading = false;
      }

    } else if (message.type === 'error') {
      console.error('HeadTTS Synthesis Error:', message.data.error);
      this._updateStatus(`TTS Synthesis Error: ${message.data.error}`);
      this.isLoading = false;
      this.playbackQueue = []; // Clear queue on error
      this.ttsData = null;
    } else {
      // Log unexpected message types/order
      console.log("[SprayReader] Received unexpected message type or non-audio message:", message);
    }
  },

  // --- Audio Playback and Word Scheduling --- //
  _playAudioAndScheduleWords: function (audioBuffer, words, wtimes) {
    if (!audioBuffer || !words || !wtimes) {
      console.error("_playAudioAndScheduleWords called with invalid data.");
      return;
    }
    // Store current chunk data for potential pause/resume
    this.ttsData = { audioBuffer, words, wtimes };

    // Ensure previous source is stopped and disconnected
    if (this.audioSource) {
      try { this.audioSource.onended = null; this.audioSource.stop(); } catch (e) { }
      this.audioSource.disconnect();
      this.audioSource = null;
    }
    clearTimeout(this.displayTimeout);
    this.displayTimeout = null;

    this.audioSource = this.audioContext.createBufferSource();
    this.audioSource.buffer = audioBuffer;
    this.audioSource.connect(this.audioContext.destination);

    const audioScheduledStartTime = this.audioContext.currentTime;
    let timeOffsetSeconds = 0;

    // If resuming, calculate the time offset where playback should start
    if (this.isPaused && this.wordIdx > 0 && this.wordIdx < wtimes.length) {
      // Make sure wtimes[this.wordIdx] is valid
      if (wtimes[this.wordIdx] !== undefined) {
        timeOffsetSeconds = wtimes[this.wordIdx] / 1000.0;
        // console.log(`Resuming playback at word index ${this.wordIdx}, time offset ${timeOffsetSeconds.toFixed(3)}s`);
      }
    }
    // We already set isPaused=false in start() before calling this
    // this.isPaused = false;

    // Store start time and offset for scheduling calculations
    this.playbackInfo = {
      audioScheduledStartTime: audioScheduledStartTime,
      audioStartOffsetSeconds: timeOffsetSeconds
    };

    // Start playback from the calculated offset
    this.audioSource.start(audioScheduledStartTime, timeOffsetSeconds);

    // Schedule the first word display relative to the start time
    this._scheduleNextWord(words, wtimes);

    // Handle natural end of audio playback
    this.audioSource.onended = () => {
      // This ensures it only triggers if playback finished naturally
      // and not due to pause() or stop()
      if (this.isRunning && this.audioSource) { // Check if still considered running
        // console.log("Audio ended naturally.");
        const wasRunning = this.isRunning;
        this.stop(); // Clean up state
        this.container.html('&nbsp;'); // Clear display on natural finish
        if (wasRunning && typeof (this.afterDoneCallback) === 'function') {
          this.afterDoneCallback();
        }
      }
      // else { console.log("Audio ended but state was not 'running'. Ignoring onended."); }
    };
  },

  _scheduleNextWord: function (words, wtimes) {
    clearTimeout(this.displayTimeout);
    this.displayTimeout = null;

    if (!this.isRunning || this.wordIdx >= words.length || !this.playbackInfo) {
      // console.log("Stopping word schedule.");
      return; // Stop recursion if not running, finished, or playback hasn't started
    }

    // Use current chunk's timings
    const currentWtimes = this.ttsData.wtimes;

    const wordStartTimeMs = currentWtimes[this.wordIdx];
    if (wordStartTimeMs === undefined) {
      console.warn(`Invalid start time for word index ${this.wordIdx}`);
      return;
    }

    // Calculate current playback time relative to the *start* of the audio buffer
    const elapsedSinceScheduledStart = this.audioContext.currentTime - this.playbackInfo.audioScheduledStartTime;
    const currentPlaybackTimeMs = (this.playbackInfo.audioStartOffsetSeconds * 1000) + (elapsedSinceScheduledStart * 1000);

    // Calculate delay until the word should be displayed
    const delayMs = Math.max(0, wordStartTimeMs - currentPlaybackTimeMs);

    // console.log(`Scheduling word ${this.wordIdx}: '${words[this.wordIdx]}' in ${delayMs.toFixed(0)} ms (Target: ${wordStartTimeMs}ms, Current: ${currentPlaybackTimeMs.toFixed(0)}ms)`);

    this.displayTimeout = setTimeout(() => {
      // Double-check state before displaying
      if (!this.isRunning) {
        // console.log("State changed before word display timeout, skipping display.");
        return;
      }

      // Display current word using the pivot logic
      this._displayWord(words[this.wordIdx]);

      // Increment index and schedule the *next* word
      this.wordIdx++;
      // Pass the original words/wtimes for the current chunk
      this._scheduleNextWord(words, currentWtimes);

    }, delayMs);
  },

  // --- Word Display --- //
  _displayWord: function (wordText) {
    // Use existing pivot function to format the word
    // Handle potential non-string words if HeadTTS returns objects/etc.
    let displayHtml = '&nbsp;';
    if (typeof wordText === 'string') {
      // Handle potential image tags if HeadTTS passes them through
      if (wordText.trim().startsWith('<img')) {
        displayHtml = wordText;
      } else if (wordText.trim().length > 0) {
        displayHtml = pivot(wordText); // Apply pivot styling
      }
    }
    this.container.html(displayHtml);
  },

  // displayWordAndIncrement removed
  // displayWordAndIncrement: function () { ... }

  // --- Speed Control --- //
  setSpeed: function (newSpeed) {
    // Validate speed (using HeadTTS range 0.25-4.0, though slider is 0.5-2.0)
    const clampedSpeed = Math.max(0.25, Math.min(4.0, newSpeed));

    this.currentSpeed = clampedSpeed;
    // Update HeadTTS setup immediately
    // This will affect *subsequent* synthesize calls or internally processed chunks
    if (this.headtts) {
      this.headtts.setup({ speed: this.currentSpeed })
        .then(() => {
          this._updateStatus(`Speed set to ${this.currentSpeed.toFixed(1)}x (will apply to next synthesis)`);
        })
        .catch(error => {
          console.error("Failed to set HeadTTS speed:", error);
          this._updateStatus("Error setting speed.");
        });
    } else {
      // Store it, will be used when headtts connects
      this._updateStatus(`Speed set to ${this.currentSpeed.toFixed(1)}x (TTS not ready yet)`);
    }
  },
};

// Keep the existing pivot function (no changes needed here)
// Find the red-character of the current word.
function pivot(word) {
  var length = word.length;

  // Longer words are "right-weighted" for easier readability.
  if (length < 6) {

    var bit = 1;
    while (word.length < 22) {
      if (bit > 0) {
        word = word + '.';
      }
      else {
        word = '.' + word;
      }
      bit = bit * -1;
    }

    var start = '';
    var end = '';
    if ((length % 2) === 0) {
      start = word.slice(0, word.length / 2);
      end = word.slice(word.length / 2, word.length);
    } else {
      start = word.slice(0, word.length / 2);
      end = word.slice(word.length / 2, word.length);
    }

    var result;
    result = "<span class='spray_start'>" + start.slice(0, start.length - 1);
    result = result + "</span><span class='spray_pivot'>";
    result = result + start.slice(start.length - 1, start.length);
    result = result + "</span><span class='spray_end'>";
    result = result + end;
    result = result + "</span>";
  }

  else {

    word = '.......' + word;

    var tail = 22 - (word.length + 7);
    if (tail > 0) {
      word = word + ('.'.repeat(tail)); // Ensure repeat is available or polyfilled
    }

    var start = word.slice(0, word.length / 2);
    var end = word.slice(word.length / 2, word.length);

    var result;
    result = "<span class='spray_start'>" + start.slice(0, start.length - 1);
    result = result + "</span><span class='spray_pivot'>";
    result = result + start.slice(start.length - 1, start.length);
    result = result + "</span><span class='spray_end'>";
    result = result + end;
    result = result + "</span>";

  }

  result = result.replace(/\./g, "<span class='invisible'>.</span>");

  return result;
}

// Keep the String.repeat polyfill if needed, or rely on modern browser support
// Let strings repeat themselves,
// because JavaScript isn't as awesome as Python.
if (!String.prototype.repeat) {
  String.prototype.repeat = function (num) {
    return new Array(num + 1).join(this);
  }
}

// Export SprayReader for use in other modules
export { SprayReader };
