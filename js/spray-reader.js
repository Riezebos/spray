var SprayReader = function (container) {
  this.container = $(container);
};
SprayReader.prototype = {
  afterDoneCallback: null,
  wpm: null,
  msPerWord: null,
  wordIdx: null,
  input: null,
  words: null,
  isRunning: false,
  isPaused: false,
  timers: [],

  setInput: function (input) {
    // Convert Markdown to HTML
    var htmlInput = marked.parse(input);

    // Create a temporary div to hold the parsed HTML
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlInput;

    var processedWords = [];

    // Function to recursively process nodes
    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        // Split text content into words and add
        var textWords = node.textContent.split(/\s+/).filter(word => word.length > 0);
        processedWords = processedWords.concat(textWords);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'IMG') {
          // Keep the image tag as a single "word"
          // Add pauses before and after the image
          processedWords.push(".");
          processedWords.push(node.outerHTML); // Add the full <img> tag
          processedWords.push(".");
        } else {
          // Recursively process child nodes for other elements (like P, H1, STRONG, EM, etc.)
          node.childNodes.forEach(processNode);
        }
      }
    }

    // Start processing from the temporary div's children
    tempDiv.childNodes.forEach(processNode);

    // The original preprocessing logic (commas, long words, punctuation) might conflict
    // or be redundant now. Let's simplify and use the processedWords directly for now.
    // We can revisit the preprocessing logic if needed.
    this.words = processedWords;

    // NOTE: The old preprocessing logic is removed/commented out below
    /*
    // Split on spaces
    var allWords = this.input.split(/\s+/);

    var word = '';
    var result = '';

    // Preprocess words
    var tmpWords = allWords.slice(0); // copy Array
    var t = 0;

    for (var i = 0; i < allWords.length; i++) {

      if (allWords[i].indexOf('.') != -1) {
        tmpWords[t] = allWords[i].replace('.', '•');
      }

      // Double up on long words and words with commas.
      if ((allWords[i].indexOf(',') != -1 || allWords[i].indexOf(':') != -1 || allWords[i].indexOf('-') != -1 || allWords[i].indexOf('(') != -1 || allWords[i].length > 8) && allWords[i].indexOf('.') == -1) {
        tmpWords.splice(t + 1, 0, allWords[i]);
        tmpWords.splice(t + 1, 0, allWords[i]);
        t++;
        t++;
      }

      // Add an additional space after punctuation.
      if (allWords[i].indexOf('.') != -1 || allWords[i].indexOf('!') != -1 || allWords[i].indexOf('?') != -1 || allWords[i].indexOf(':') != -1 || allWords[i].indexOf(';') != -1 || allWords[i].indexOf(')') != -1) {
        tmpWords.splice(t + 1, 0, ".");
        tmpWords.splice(t + 1, 0, ".");
        tmpWords.splice(t + 1, 0, ".");
        t++;
        t++;
        t++;
      }

      t++;
    }

    this.words = tmpWords.slice(0);
    */

    this.wordIdx = 0;
    this.isPaused = false; // Reset pause state on new input
  },

  setWpm: function (wpm) {
    this.wpm = parseInt(wpm, 10);
    this.msPerWord = 60000 / wpm;
  },

  start: function () {
    // Don't start if already running
    if (this.isRunning) {
      return;
    }

    // If paused, just clear the pause state and restart the timer
    if (this.isPaused) {
      this.isPaused = false;
      this.isRunning = true;

      thisObj = this; // Ensure thisObj is set
      this.timers.push(setInterval(function () {
        thisObj.displayWordAndIncrement();
      }, this.msPerWord));
      return;
    }

    // If not paused and not running, start from the beginning (or current index if applicable)
    this.isRunning = true;
    this.isPaused = false;

    thisObj = this;

    this.timers.push(setInterval(function () {
      thisObj.displayWordAndIncrement();
    }, this.msPerWord));
  },

  stop: function () {
    this.isRunning = false;
    this.isPaused = false;
    this.wordIdx = 0; // Reset word index on stop

    for (var i = 0; i < this.timers.length; i++) {
      clearTimeout(this.timers[i]);
    }
    this.timers = []; // Clear timers array
    this.container.html('&nbsp;'); // Clear display on stop
  },

  pause: function () {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    this.isPaused = true;

    for (var i = 0; i < this.timers.length; i++) {
      clearTimeout(this.timers[i]);
    }
    this.timers = []; // Clear timers array
  },

  displayWordAndIncrement: function () {
    var currentItem = this.words[this.wordIdx];

    // Check if the current item is an image tag
    if (typeof currentItem === 'string' && currentItem.trim().startsWith('<img')) {
      this.container.html(currentItem); // Display the image HTML directly
    } else {
      // Otherwise, process as a normal word
      var pivotedWord = pivot(currentItem);
      this.container.html(pivotedWord);
    }

    this.wordIdx++;
    if (this.wordIdx >= this.words.length) { // Use this.wordIdx and this.words
      this.wordIdx = 0;
      this.stop();
      if (typeof (this.afterDoneCallback) === 'function') {
        this.afterDoneCallback();
      }
    }
  }
};

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
      word + ('.'.repeat(tail));
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

// Let strings repeat themselves,
// because JavaScript isn't as awesome as Python.
String.prototype.repeat = function (num) {
  return new Array(num + 1).join(this);
}
