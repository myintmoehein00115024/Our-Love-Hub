// 2025: device-aware WebGL scene, with pausing on background tabs.
// Synchronised double-beat experience. Mobile haptics require an explicit tap.
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouchSizedScreen = Math.min(window.innerWidth, window.innerHeight) < 830;
const numSpikes = prefersReducedMotion ? 2400 : (isTouchSizedScreen ? 5200 : 13000);
const motionButton = document.getElementById('heartbeat-motion-toggle');
const experienceButton = document.getElementById('heartbeat-experience-toggle');
const experienceStatus = document.getElementById('heartbeat-experience-status');
const fallback = document.getElementById('heartbeat-fallback');
const AudioConstructor = window.AudioContext || window.webkitAudioContext;
const supportsVibration = typeof navigator.vibrate === 'function';
let sceneReady = false;
let userPaused = prefersReducedMotion;
let experienceEnabled = false;
let audioContext = null;
let heartbeatTimeline = null;
let rotationTween = null;
let vibrationBlocked = false;

function syncMotionButton(){
  if (!motionButton) return;
  motionButton.setAttribute('aria-pressed', String(userPaused));
  motionButton.setAttribute('aria-label', userPaused ? '播放心跳动画' : '暂停心跳动画');
  motionButton.innerHTML = userPaused ? '▶ <span>播放动画</span>' : 'Ⅱ <span>暂停动画</span>';
}
function syncExperienceButton(){
  if (!experienceButton) return;
  const supported = supportsVibration || !!AudioConstructor;
  experienceButton.disabled = !supported;
  experienceButton.setAttribute('aria-pressed', String(experienceEnabled));
  experienceButton.innerHTML = experienceEnabled ? '♡ <span>关闭心跳感</span>' : '♡ <span>感受心跳</span>';
  if (!experienceStatus) return;
  if (!supported) experienceStatus.textContent = '当前浏览器不支持网页震动或心跳音效';
  else if (userPaused && experienceEnabled) experienceStatus.textContent = '已暂停 · 点击播放恢复心跳';
  else if (experienceEnabled && document.hidden) experienceStatus.textContent = '页面切到后台，心跳已暂停';
  else if (experienceEnabled && supportsVibration && !vibrationBlocked) experienceStatus.textContent = '咚—咚 ♡ 震动与轻柔心跳声';
  else if (experienceEnabled && supportsVibration && vibrationBlocked) experienceStatus.textContent = '系统限制了震动，心跳音效仍可使用';
  else if (experienceEnabled) experienceStatus.textContent = '咚—咚 ♡ 苹果浏览器以心跳音效代替震动';
  else if (supportsVibration) experienceStatus.textContent = '安卓：点一下，感受每次双拍心跳';
  else experienceStatus.textContent = '苹果网页暂不支持震动 · 可开启轻柔心跳声';
}
function playThump(delay, louder) {
  if (!audioContext || audioContext.state !== 'running') return;
  try {
    const start = audioContext.currentTime + delay;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(louder ? 92 : 78, start);
    osc.frequency.exponentialRampToValueAtTime(louder ? 49 : 43, start + 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(louder ? 0.12 : 0.085, start + 0.017);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(start);
    osc.stop(start + 0.18);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch (_) { /* Web Audio unsupported or blocked; visual beat remains. */ }
}
function stopVibration(){
  if (supportsVibration) {
    try { navigator.vibrate(0); } catch (_) {}
  }
}
function emitHeartbeat(){
  if (!experienceEnabled || userPaused || document.hidden) return;
  // Two haptic beats: lub (lighter), 140 ms gap, dub (a little stronger).
  if (supportsVibration && !vibrationBlocked) {
    try {
      if (navigator.vibrate([60, 140, 95]) === false) {
        vibrationBlocked = true;
        syncExperienceButton();
      }
    } catch (_) { vibrationBlocked = true; syncExperienceButton(); }
  }
  playThump(0, false);
  playThump(0.20, true);
}
function updateRenderLoop(){
  const paused = userPaused || document.hidden;
  if (heartbeatTimeline) heartbeatTimeline.paused(paused);
  if (rotationTween) rotationTween.paused(paused);
  if (paused) stopVibration();
  if (sceneReady) {
    if (paused) {
      renderer.setAnimationLoop(null);
      renderer.render(scene, camera);
    } else renderer.setAnimationLoop(renderFrame);
  }
  syncExperienceButton();
}
if (motionButton) motionButton.addEventListener('click', () => {
  userPaused = !userPaused;
  syncMotionButton();
  updateRenderLoop();
});
if (experienceButton) experienceButton.addEventListener('click', () => {
  experienceEnabled = !experienceEnabled;
  if (experienceEnabled) {
    // Must be initiated by this user gesture, not page load.
    try {
      if (AudioConstructor && !audioContext) audioContext = new AudioConstructor();
      if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch (_) { audioContext = null; }
    if (userPaused) {
      userPaused = false;
      syncMotionButton();
    }
    updateRenderLoop();
    if (heartbeatTimeline && !document.hidden) {
      heartbeatTimeline.restart();
      emitHeartbeat();
    }
  } else {
    stopVibration();
    updateRenderLoop();
  }
  syncExperienceButton();
});
document.addEventListener('visibilitychange', updateRenderLoop);
window.addEventListener('pagehide', () => {
  stopVibration();
  if (heartbeatTimeline) heartbeatTimeline.pause();
  if (rotationTween) rotationTween.pause();
});
syncMotionButton();
syncExperienceButton();

// The rhythm and haptics are independent of WebGL: older devices keep the heartbeat experience.
let scene = null;
let camera = null;
let renderer = null;
let renderFrame = null;
const beat = { a: 0 };
// One cycle lasts ~0.92 seconds (about 65 double-beats/minute):
// soft "lub" followed 200 ms later by a stronger "dub", then rest.
heartbeatTimeline = gsap.timeline({
  repeat: -1,
  repeatDelay: 0.46,
  paused: userPaused || document.hidden,
  onRepeat: emitHeartbeat
});
heartbeatTimeline
  .to(beat, { a: 0.90, duration: 0.11, ease: 'power2.out' })
  .to(beat, { a: 0.13, duration: 0.09, ease: 'power2.in' })
  .to(beat, { a: 1.25, duration: 0.10, ease: 'power2.out' })
  .to(beat, { a: 0.00, duration: 0.16, ease: 'power2.inOut' });

try {
  scene = new THREE.Scene();
camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

renderer = new THREE.WebGLRenderer({
  antialias: !isTouchSizedScreen,
  alpha: true
});
// Keep the page background visible through the WebGL canvas.
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouchSizedScreen ? 1.35 : 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

camera.position.z = 1;

const controls = new THREE.TrackballControls(camera, renderer.domElement);
controls.noPan = true;
controls.maxDistance = 3;
controls.minDistance = 0.7;

const group = new THREE.Group();
scene.add(group);

rotationTween = gsap.to(group.rotation, {
  y: Math.PI * 2,
  duration: 18,
  ease: 'none',
  repeat: -1,
  paused: userPaused || document.hidden
});

let heart = null;
let sampler = null;
let originHeart = null;
new THREE.OBJLoader().load('https://assets.codepen.io/127738/heart_2.obj',obj => {
  heart = obj.children[0];
  heart.geometry.rotateX(-Math.PI * 0.5);
  heart.geometry.scale(0.04, 0.04, 0.04);
  heart.geometry.translate(0, -0.4, 0);
  group.add(heart);
  
  heart.material = new THREE.MeshBasicMaterial({
    color: 0xf07aa8    
  });
  originHeart = Array.from(heart.geometry.attributes.position.array);
  sampler = new THREE.MeshSurfaceSampler(heart).build();
  init();
  sceneReady = true;
  if (fallback) fallback.hidden = true;
  updateRenderLoop();
},undefined, function(){
  if (fallback) fallback.hidden = false;
});

let positions = [];
const geometry = new THREE.BufferGeometry();
const material = new THREE.LineBasicMaterial({
  color: 0xffffff
});
const lines = new THREE.LineSegments(geometry, material);
group.add(lines);

const simplex = new SimplexNoise();
const pos = new THREE.Vector3();
class Grass {
  constructor () {
    sampler.sample(pos);
    this.pos = pos.clone();
    this.scale = Math.random() * 0.01 + 0.001;
    this.one = this.pos.clone();
    this.two = this.pos.clone();
  }
  update (a) {
    const noise = simplex.noise4D(this.pos.x*1.5, this.pos.y*1.5, this.pos.z*1.5, a * 0.0005) + 1;
    this.one.copy(this.pos).multiplyScalar(1.01 + (noise * 0.15 * beat.a));
    this.two.copy(this.one).multiplyScalar(1 + this.scale / Math.max(this.one.length(), 0.0001));
  }
}

let spikes = [];
let linePositions = null;
function init () {
  positions = [];
  spikes = [];
  for (let i = 0; i < numSpikes; i++) spikes.push(new Grass());
  linePositions = new Float32Array(numSpikes * 6);
  const attribute = new THREE.BufferAttribute(linePositions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
}



renderFrame = function render(a) {
  for (let i = 0; i < spikes.length; i++) {
    const g = spikes[i];
    g.update(a);
    const offset = i * 6;
    linePositions[offset] = g.one.x;
    linePositions[offset + 1] = g.one.y;
    linePositions[offset + 2] = g.one.z;
    linePositions[offset + 3] = g.two.x;
    linePositions[offset + 4] = g.two.y;
    linePositions[offset + 5] = g.two.z;
  }
  geometry.attributes.position.needsUpdate = true;
  
  const vs = heart.geometry.attributes.position.array;
  for (let i = 0; i < vs.length; i+=3) {
    const noise = simplex.noise4D(originHeart[i]*1.5, originHeart[i+1]*1.5, originHeart[i+2]*1.5, a * 0.0005) + 1;
    const multiplier = 1 + noise * 0.15 * beat.a;
    vs[i] = originHeart[i] * multiplier;
    vs[i+1] = originHeart[i+1] * multiplier;
    vs[i+2] = originHeart[i+2] * multiplier;
  }
  heart.geometry.attributes.position.needsUpdate = true;
  
  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("resize", onWindowResize, false);
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
} catch (error) {
  // A WebGL creation error must never prevent sound or mobile vibration.
  sceneReady = false;
  if (fallback) fallback.hidden = false;
  console.warn('3D heart unavailable; synchronized heartbeat controls remain active.');
}
