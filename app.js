import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const autoOrbitToggle = document.getElementById('autoOrbitToggle');
    const soundBtns = document.querySelectorAll('.sound-btn');
    const elevationSlider = document.getElementById('elevationSlider');
    const elevationValue = document.getElementById('elevationValue');
    const dimBtns = document.querySelectorAll('.dim-btn');
    const elevationControlBlock = document.getElementById('elevationControlBlock');
    const canvas = document.getElementById('webgl-canvas');
    const stageContainer = document.getElementById('stageContainer');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Audio Context & Nodes
    let audioCtx;
    let panner;
    let oscillator;
    let LFO;
    let currentSoundType = 'engine';
    let isPlaying = false;
    let is3DMode = false;
    let noiseFilter;
    let noiseBufferSource;
    let autoOrbit = false;

    // Three.js State
    let scene, camera, renderer;
    let orbitControls, dragControls;
    let listenerFace, soundOrb, gridHelper;
    let clock = new THREE.Clock();
    let targetCameraPos = new THREE.Vector3();
    let isTransitioningCamera = false;

    initThreeJS();
    initUIEventListeners();

    function initThreeJS() {
        // Scene setup
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0d0f12);

        // Add subtle fog to blend the horizon
        scene.fog = new THREE.Fog(0x0d0f12, 10, 50);

        // Camera setup
        const aspect = canvas.clientWidth / canvas.clientHeight;
        camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
        camera.position.set(0, 15, 0.001); // Initial position

        // Renderer setup
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(5, 10, 5);
        scene.add(directionalLight);

        // Grid plane
        gridHelper = new THREE.GridHelper(30, 30, 0x333333, 0x222222);
        gridHelper.position.y = -0.5; // Slightly below Face
        scene.add(gridHelper);

        // Circular boundary visually
        const circleGeo = new THREE.RingGeometry(9.8, 10, 64);
        const circleMat = new THREE.MeshBasicMaterial({ color: 0x7a3bfc, side: THREE.DoubleSide, opacity: 0.3, transparent: true });
        const boundary = new THREE.Mesh(circleGeo, circleMat);
        boundary.rotation.x = -Math.PI / 2;
        boundary.position.y = -0.49;
        scene.add(boundary);

        // Sound Orb
        const orbGeo = new THREE.SphereGeometry(0.7, 32, 32);
        const orbMat = new THREE.MeshStandardMaterial({
            color: 0x00f0ff,
            emissive: 0x005088,
            emissiveIntensity: 1,
            roughness: 0.2,
            metalness: 0.8
        });
        soundOrb = new THREE.Mesh(orbGeo, orbMat);
        soundOrb.position.set(2, 0, -2);
        scene.add(soundOrb);

        const loader = new GLTFLoader();
        loader.load(
            'asset/female_head_sculpt..glb',
            (gltf) => {
                listenerFace = gltf.scene;

                // Auto-scale and center regardless of original model size
                const box = new THREE.Box3().setFromObject(listenerFace);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                // We want the head to be about 2.5 units large
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = maxDim > 0 ? (2.5 / maxDim) : 1;

                listenerFace.scale.set(scale, scale, scale);

                // Offset the position to properly center the exact geometry 
                listenerFace.position.x = -center.x * scale;
                listenerFace.position.y = (-center.y * scale) + 1.0; // Lift up slightly from the grid floor
                listenerFace.position.z = -center.z * scale;

                listenerFace.rotation.y = Math.PI;
                scene.add(listenerFace);
                loadingOverlay.style.display = 'none'; // Hide loading text
            },
            undefined,
            (error) => {
                console.error('Error loading face model:', error);
                loadingOverlay.innerHTML = '<span style="color:red;">Error loading model</span>';
            }
        );

        // OrbitControls for Camera
        orbitControls = new OrbitControls(camera, renderer.domElement);
        orbitControls.enableDamping = true;
        orbitControls.dampingFactor = 0.05;
        orbitControls.minDistance = 2;
        orbitControls.maxDistance = 20;
        orbitControls.enableZoom = false; // Disable zooming so scrolling down the page works smoothly if hovered
        orbitControls.enablePan = false; // Disable panning so the camera doesn't jump abruptly when switching

        // Start in 2D mode (top down view)
        setCamera2D();

        // Drag Controls for Orb
        dragControls = new DragControls([soundOrb], camera, renderer.domElement);

        let initialOrbY = 0;

        dragControls.addEventListener('dragstart', function (event) {
            orbitControls.enabled = false;
        });

        dragControls.addEventListener('drag', function (event) {
            // Keep the orb within limits
            const dist = Math.sqrt(event.object.position.x ** 2 + event.object.position.z ** 2);
            if (dist > 10) {
                // clamp
                event.object.position.x = (event.object.position.x / dist) * 10;
                event.object.position.z = (event.object.position.z / dist) * 10;
            }

            if (!is3DMode) {
                event.object.position.y = 0;
            } else {
                event.object.position.y = Math.max(-10, Math.min(10, event.object.position.y));
                if (elevationSlider) {
                    elevationSlider.value = event.object.position.y;
                    elevationValue.textContent = (event.object.position.y > 0 ? '+' : '') + event.object.position.y.toFixed(1);
                }
            }

            updateAudioMap();
        });

        dragControls.addEventListener('dragend', function (event) {
            orbitControls.enabled = true;
        });

        window.addEventListener('resize', onWindowResize);
        animate();
    }

    function setCamera2D() {
        targetCameraPos.set(0, 15, 0.001); // Top down
        orbitControls.enabled = false; // Completely disable during transition
        orbitControls.enableRotate = false;
        isTransitioningCamera = true;
    }

    function setCamera3D() {
        // Move a bit on the -Z axis and a bit lower from the Y axis as requested
        targetCameraPos.set(0, 8, 8);
        orbitControls.enabled = false; // Completely disable during transition
        orbitControls.enableRotate = false;
        isTransitioningCamera = true;
    }

    function onWindowResize() {
        const width = stageContainer.clientWidth;
        const height = stageContainer.clientHeight;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function animate() {
        requestAnimationFrame(animate);

        if (isTransitioningCamera) {
            // Smoothly interpolate position (speeding it up slightly to avoid slow ease-in/out snaps)
            camera.position.lerp(targetCameraPos, 0.08);
            camera.lookAt(0, 0, 0); // Keep focused on center while sweeping

            // Reduced to extremely small threshold to ensure it finishes moving before handing back control
            if (camera.position.distanceTo(targetCameraPos) < 0.01) {
                camera.position.copy(targetCameraPos);
                camera.lookAt(0, 0, 0);
                isTransitioningCamera = false;

                // Re-enable controls and sync internal state
                orbitControls.enabled = true;
                if (is3DMode) {
                    orbitControls.enableRotate = true;
                }
                orbitControls.update();
            }
        } else {
            // Only update orbit controls if not transition
            orbitControls.update();
        }

        // Auto Orbit Animation
        if (autoOrbit && soundOrb) {
            const time = clock.getElapsedTime();
            const sweepSpeed = 0.5;
            const radius = 6;
            soundOrb.position.x = Math.cos(time * sweepSpeed) * radius;
            soundOrb.position.z = Math.sin(time * sweepSpeed) * radius;
            updateAudioMap();
        }

        // Orb pulsing effect when playing sound
        if (isPlaying && soundOrb) {
            const time = clock.getElapsedTime();
            soundOrb.material.emissiveIntensity = 1 + Math.sin(time * 10) * 0.5; // Throb
        } else if (soundOrb) {
            soundOrb.material.emissiveIntensity = 1;
        }

        renderer.render(scene, camera);
    }

    // Audio Control -----------------------------------------

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (!panner) {
            panner = audioCtx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = 1;
            panner.maxDistance = 10000;
            panner.rolloffFactor = 1;
            panner.coneInnerAngle = 360;
            panner.coneOuterAngle = 0;
            panner.coneOuterGain = 0;

            panner.connect(audioCtx.destination);

            if (audioCtx.listener.forwardX) {
                audioCtx.listener.forwardX.value = 0;
                audioCtx.listener.forwardY.value = 0;
                audioCtx.listener.forwardZ.value = -1;
                audioCtx.listener.upX.value = 0;
                audioCtx.listener.upY.value = 1;
                audioCtx.listener.upZ.value = 0;
                audioCtx.listener.positionX.value = 0;
                audioCtx.listener.positionY.value = 0;
                audioCtx.listener.positionZ.value = 0;
            } else {
                audioCtx.listener.setOrientation(0, 0, -1, 0, 1, 0);
                audioCtx.listener.setPosition(0, 0, 0);
            }
        }
    }

    function updateAudioMap() {
        if (!panner || !audioCtx || !soundOrb) return;

        // ThreeJS Coordinate Mapping
        // X = right, Y = up, Z = out of screen (towards viewer)
        // Web Audio uses same right-handed cartesian coordinates 
        // We'll pass them directly, possibly scaled
        const scale = 1.0;

        const audioX = soundOrb.position.x * scale;
        const audioY = soundOrb.position.y * scale;
        const audioZ = soundOrb.position.z * scale;

        if (panner.positionX) {
            panner.positionX.setTargetAtTime(audioX, audioCtx.currentTime, 0.05);
            panner.positionY.setTargetAtTime(audioY, audioCtx.currentTime, 0.05);
            panner.positionZ.setTargetAtTime(audioZ, audioCtx.currentTime, 0.05);
        } else {
            panner.setPosition(audioX, audioY, audioZ);
        }
    }

    // Generators -------------------------------

    function playEngine() {
        oscillator = audioCtx.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = 50;

        LFO = audioCtx.createOscillator();
        LFO.type = 'sine';
        LFO.frequency.value = 2; // 2Hz tremolo

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.5;

        oscillator.connect(gainNode);

        const lfoGain = audioCtx.createGain();
        lfoGain.gain.value = 0.5;
        LFO.connect(lfoGain);
        lfoGain.connect(gainNode.gain);

        gainNode.connect(panner);

        oscillator.start();
        LFO.start();
    }

    function createNoiseBuffer() {
        const bufferSize = audioCtx.sampleRate * 2;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }

    function playNoise() {
        noiseBufferSource = audioCtx.createBufferSource();
        noiseBufferSource.buffer = createNoiseBuffer();
        noiseBufferSource.loop = true;

        noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 1000;
        noiseFilter.Q.value = 1;

        noiseBufferSource.connect(noiseFilter);
        noiseFilter.connect(panner);

        noiseBufferSource.start();
    }

    function playBeep() {
        oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = 800; // High frequency beep

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0;

        oscillator.connect(gainNode);
        gainNode.connect(panner);

        oscillator.start();

        window.beepInterval = setInterval(() => {
            if (!isPlaying) return;
            const now = audioCtx.currentTime;
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(1, now + 0.05);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        }, 1000);
    }

    function startSound() {
        initAudio();

        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        stopSound();
        isPlaying = true;

        if (currentSoundType === 'engine') playEngine();
        else if (currentSoundType === 'noise') playNoise();
        else if (currentSoundType === 'beep') playBeep();

        updateAudioMap();
    }

    function stopSound() {
        isPlaying = false;

        if (oscillator) {
            try { oscillator.stop(); } catch (e) { }
            oscillator.disconnect();
            oscillator = null;
        }
        if (LFO) {
            try { LFO.stop(); } catch (e) { }
            LFO.disconnect();
            LFO = null;
        }
        if (noiseBufferSource) {
            try { noiseBufferSource.stop(); } catch (e) { }
            noiseBufferSource.disconnect();
            noiseBufferSource = null;
        }
        if (window.beepInterval) {
            clearInterval(window.beepInterval);
        }
    }

    // Custom UI Listeners
    function initUIEventListeners() {
        toggleAudioBtn.addEventListener('click', () => {
            if (isPlaying) {
                stopSound();
                toggleAudioBtn.textContent = 'Start Sound';
                toggleAudioBtn.classList.remove('playing');
            } else {
                startSound();
                toggleAudioBtn.textContent = 'Stop Sound';
                toggleAudioBtn.classList.add('playing');
            }
        });

        soundBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                soundBtns.forEach(b => b.classList.remove('active'));
                const target = e.target;
                target.classList.add('active');
                currentSoundType = target.dataset.sound;
                if (isPlaying) startSound();
            });
        });

        dimBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                dimBtns.forEach(b => b.classList.remove('active'));
                const target = e.target;
                target.classList.add('active');
                is3DMode = target.dataset.dim === '3d';

                if (is3DMode) {
                    elevationControlBlock.style.opacity = '1';
                    elevationControlBlock.style.pointerEvents = 'auto';
                    setCamera3D();

                    // Reapply height
                    const val = parseFloat(elevationSlider.value);
                    if (soundOrb) soundOrb.position.y = val;
                } else {
                    elevationControlBlock.style.opacity = '0.3';
                    elevationControlBlock.style.pointerEvents = 'none';
                    setCamera2D();

                    if (soundOrb) soundOrb.position.y = 0;
                }
                updateAudioMap();
            });
        });

        autoOrbitToggle.addEventListener('change', (e) => {
            autoOrbit = e.target.checked;
        });

        if (elevationSlider) {
            elevationSlider.addEventListener('input', (e) => {
                if (!is3DMode) return;
                const val = parseFloat(e.target.value);
                elevationValue.textContent = (val > 0 ? '+' : '') + val.toFixed(1);

                if (soundOrb) {
                    soundOrb.position.y = val;
                    updateAudioMap();
                }
            });
        }
    }
});
