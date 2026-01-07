// apple's audio bypasser — updated for full-height wrapper & smooth UI
const fileinput = document.getElementById("fileinput");
const dropzone = document.getElementById("dropzone");
const filelist = document.getElementById("filelist");
const processBtn = document.getElementById("processBtn");
const previewBtn = document.getElementById("previewBtn");
const progresswrap = document.getElementById("progresswrap");
const progressbar = document.getElementById("progress");
const progresslabel = document.getElementById("progresslabel");

let files = [];
let processed = [];
let targetDb = -21;

// --- create large-file compression button
const largeBtn = document.createElement("button");
largeBtn.textContent = "if audio file(s) are over 20mb, click to upload them here to compress";
largeBtn.className = "btn alt large-compress-btn";
largeBtn.onclick = () => window.open("https://cloudconvert.com/wav-to-mp3", "_blank");
const controlsDiv = document.querySelector(".controls");
if (controlsDiv && !controlsDiv.contains(largeBtn)) controlsDiv.appendChild(largeBtn);

// --- preset buttons ---
document.querySelectorAll(".preset").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".preset").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    targetDb = parseFloat(btn.dataset.db);
    console.log("target dB set to", targetDb);
  });
});

// --- input handling ---
dropzone.addEventListener("click", () => fileinput.click());
fileinput.addEventListener("change", e => {
  handleFiles(e.target.files);
  fileinput.value = "";
});
dropzone.addEventListener("dragover", e => e.preventDefault());
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  handleFiles(e.dataTransfer.files);
});

// --- handle files ---
function handleFiles(list) {
  const arr = Array.from(list).filter(f => f.type.startsWith("audio/"));
  files = files.concat(arr);
  renderList();
}

// --- render file list ---
function renderList() {
  filelist.innerHTML = "";
  files.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "file-row";
    row.innerHTML = `
      <div class="file-meta">
        <div class="fname">${f.name.toLowerCase()}</div>
        <div class="fsmall">${(f.size / 1024 / 1024).toFixed(2)} mb</div>
      </div>
      <div>
        <button class="action-btn remove">remove</button>
        <button class="action-btn download">download</button>
      </div>`;
    
    row.querySelector(".remove").onclick = () => {
      files.splice(i, 1);
      processed.splice(i, 1);
      renderList();
    };
    
    row.querySelector(".download").onclick = () => {
      if (!processed[i]) return alert("process the file first");
      const a = document.createElement("a");
      a.href = processed[i].url;
      a.download = processed[i].name;
      a.click();
    };

    filelist.appendChild(row);
  });
}

// --- audio helpers ---
async function decodeAudio(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const ab = await file.arrayBuffer();
  return await ctx.decodeAudioData(ab);
}

async function renderSpedBuffer(buffer, speedFactor = 2.5) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const targetLength = Math.ceil(buffer.length / speedFactor);
  const off = new OfflineAudioContext(numChannels, targetLength, sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = speedFactor;
  src.connect(off.destination);
  src.start(0);
  return await off.startRendering();
}

function getPeak(buf) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

function applyGain(buf, gain) {
  const out = new AudioBuffer({
    length: buf.length,
    numberOfChannels: buf.numberOfChannels,
    sampleRate: buf.sampleRate,
  });
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      let v = src[i] * gain;
      dst[i] = Math.max(-1, Math.min(1, v));
    }
  }
  return out;
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = buffer.length * blockAlign;
  const bufferLen = 44 + dataSize;
  const ab = new ArrayBuffer(bufferLen);
  const view = new DataView(ab);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      view.setInt16(offset, channels[c][i] * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

// --- process all files ---
async function processAll() {
  if (!files.length) return alert("no files selected");
  processed = [];
  progresswrap.hidden = false;
  progressbar.style.transition = "width 0.3s ease";
  progressbar.style.width = "0%";
  const startTs = performance.now();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    progresslabel.textContent = `processing ${i + 1}/${files.length}`;
    const decoded = await decodeAudio(f);
    const sped = await renderSpedBuffer(decoded, 2.5);
    const peak = getPeak(sped) || 1e-9;
    const targetLinear = Math.pow(10, targetDb / 20) * 0.95;
    const gainMult = targetLinear / peak;
    const finalBuf = applyGain(sped, gainMult);
    const wavBlob = audioBufferToWav(finalBuf);
    const url = URL.createObjectURL(wavBlob);
    processed.push({ name: `${f.name.replace(/\.[^/.]+$/, "")}_x2.5_${targetDb}db.wav`, blob: wavBlob, url });
    progressbar.style.width = `${((i + 1) / files.length) * 100}%`;

    // smooth time estimate
    const elapsed = performance.now() - startTs;
    const avg = elapsed / (i + 1);
    const remaining = avg * (files.length - i - 1);
    progresslabel.textContent = `processing ${i + 1}/${files.length} — approx ${(remaining / 1000).toFixed(1)}s left`;
  }

  if (processed.length === 1) {
    const a = document.createElement("a");
    a.href = processed[0].url;
    a.download = processed[0].name;
    a.click();
  } else {
    const zip = new JSZip();
    const folder = zip.folder("eclipse_audio_bypasser_outputs");
    processed.forEach(p => folder.file(p.name, p.blob));
    const content = await zip.generateAsync({ type: "blob" }, meta => {
      progressbar.style.width = `${Math.floor(meta.percent)}%`;
      progresslabel.textContent = `zipping ${Math.round(meta.percent)}%`;
    });
    saveAs(content, "eclipse_audio_bypasser.zip");
    progresslabel.textContent = "zip ready";
  }

  progresslabel.textContent = `done (${processed.length} files)`;
  renderList();
}

processBtn.onclick = () => processAll();

// --- preview first 5s ---
previewBtn.onclick = async () => {
  if (!files.length) return alert("no file to preview");
  const f = files[0];
  const decoded = await decodeAudio(f);
  const sped = await renderSpedBuffer(decoded, 2.5);
  const peak = getPeak(sped) || 1e-9;
  const targetLinear = Math.pow(10, targetDb / 20) * 0.95;
  const gainMult = targetLinear / peak;
  const finalBuf = applyGain(sped, gainMult);

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const sliceLen = Math.min(finalBuf.length, Math.floor(5 * finalBuf.sampleRate));
  const slice = ctx.createBuffer(finalBuf.numberOfChannels, sliceLen, finalBuf.sampleRate);
  for (let ch = 0; ch < finalBuf.numberOfChannels; ch++) {
    slice.copyToChannel(finalBuf.getChannelData(ch).slice(0, sliceLen), ch);
  }
  const src = ctx.createBufferSource();
  src.buffer = slice;
  src.connect(ctx.destination);
  src.start();
};
