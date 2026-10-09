// 2025: device-aware WebGL scene, with pausing on background tabs.
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouchSizedScreen = Math.min(window.innerWidth, window.innerHeight) < 830;
const numSpikes = prefersReducedMotion ? 2400 : (isTouchSizedScreen ? 5200 : 13000);
const motionButton = document.getElementById('heartbeat-motion-toggle');
const fallback = document.getElementById('heartbeat-fallback');
let sceneReady = false;
let userPaused = prefersReducedMotion;
function syncMotionButton(){
  if (!motionButton) return;
  motionButton.setAttribute('aria-pressed', String(userPaused));
  motionButton.setAttribute('aria-label', userPaused ? '播放心跳动画' : '暂停心跳动画');
  motionButton.innerHTML = userPaused ? '▶ <span>播放动画</span>' : 'Ⅱ <span>暂停动画</span>';
}
function updateRenderLoop(){
  if (!sceneReady) return;
  if (userPaused || document.hidden){
    renderer.setAnimationLoop(null);
    renderer.render(scene,camera);
  }else renderer.setAnimationLoop(render);
}
if (motionButton) motionButton.addEventListener('click',function(){
  userPaused = !userPaused;
  syncMotionButton();
  updateRenderLoop();
});
document.addEventListener('visibilitychange',updateRenderLoop);
syncMotionButton();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({
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

const beat = { a: 0 };
gsap.timeline({
  repeat: -1,
  repeatDelay: 0.3
}).to(beat, {
  a: 1.2,
  duration: 0.6,
  ease: 'power2.in'
}).to(beat, {
  a: 0.0,
  duration: 0.6,
  ease: 'power3.out'
});
gsap.to(group.rotation, {
  y: Math.PI * 2,
  duration: 12,
  ease: 'none',
  repeat: -1
});

function render(a) {
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