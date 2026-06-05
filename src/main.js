import * as THREE from 'three';
import './style.css';

const canvas = document.querySelector('#game-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111827);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 4;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const cubeGeometry = new THREE.BoxGeometry(1.4, 1.4, 1.4);
const cubeMaterial = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  metalness: 0.2,
  roughness: 0.35,
});
const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
scene.add(cube);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);

function handleResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener('resize', handleResize);

function animate() {
  cube.rotation.x += 0.008;
  cube.rotation.y += 0.012;

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
