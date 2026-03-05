document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const stage = document.getElementById('stage');
    const sourceEl = document.getElementById('soundSource');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const autoOrbitToggle = document.getElementById('autoOrbitToggle');
    const soundBtns = document.querySelectorAll('.sound-btn');

    // Audio Context & Nodes
    let audioCtx;
    let panner;
    let oscillator;
    let LFO;
    let currentSoundType = 'engine';
    let isPlaying = false;
    let noiseFilter;
    let noiseBufferSource;

    // Movement state
    let isDragging = false;
    let autoOrbit = false;
    let angle = -Math.PI / 2; // Start at top
    let orbitAnimationId;

    // Initialize Audio
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if(!panner) {
            // Panner Node setup for 3D spatialization
            panner = audioCtx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = 1;
            panner.maxDistance = 10000;
            panner.rolloffFactor = 1;
            panner.coneInnerAngle = 360;
            panner.coneOuterAngle = 0;
            panner.coneOuterGain = 0;
            
            // Connect panner to output
            panner.connect(audioCtx.destination);
            
            // Listener orientation (looking forward)
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
                audioCtx.listener.setOrientation(0,0,-1,0,1,0);
                audioCtx.listener.setPosition(0,0,0);
            }
        }
    }

    // Sound Generators
    function playEngine() {
        oscillator = audioCtx.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = 50; 
        
        LFO = audioCtx.createOscillator();
        LFO.type = 'sine';
        LFO.frequency.value = 2; // 2Hz tremolo to sound like an engine

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.5; // base gain
        
        oscillator.connect(gainNode);
        
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.value = 0.5; // modulation depth
        LFO.connect(lfoGain);
        lfoGain.connect(gainNode.gain);

        gainNode.connect(panner);
        
        oscillator.start();
        LFO.start();
    }

    function createNoiseBuffer() {
        const bufferSize = audioCtx.sampleRate * 2; // 2 seconds of noise
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

        // Add a bandpass filter to sound more like static/wind
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

        // Beep loop interval using Web Audio API timing
        window.beepInterval = setInterval(() => {
            if(!isPlaying) return;
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

        stopSound(); // Ensure previous is stopped
        isPlaying = true;

        if (currentSoundType === 'engine') playEngine();
        else if (currentSoundType === 'noise') playNoise();
        else if (currentSoundType === 'beep') playBeep();
        
        // Ensure positional update applied immediately
        const x = parseFloat(sourceEl.style.left) || (stage.offsetWidth / 2);
        const y = parseFloat(sourceEl.style.top) || (stage.offsetHeight * 0.1);
        
        // Add a slight delay to ensure position maps coordinate properly
        setTimeout(() => {
            updateCoordinateMap(x, y);
        }, 50);
    }

    function stopSound() {
        isPlaying = false;
        
        if (oscillator) {
            try { oscillator.stop(); } catch(e){}
            oscillator.disconnect();
            oscillator = null;
        }
        if (LFO) {
            try { LFO.stop(); } catch(e){}
            LFO.disconnect();
            LFO = null;
        }
        if (noiseBufferSource) {
            try { noiseBufferSource.stop(); } catch(e){}
            noiseBufferSource.disconnect();
            noiseBufferSource = null;
        }
        if (window.beepInterval) {
            clearInterval(window.beepInterval);
        }
    }

    // Event Listeners
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
            
            if (isPlaying) {
                startSound(); // Restart with new sound
            }
        });
    });

    autoOrbitToggle.addEventListener('change', (e) => {
        autoOrbit = e.target.checked;
        if (autoOrbit) {
            startOrbit();
        } else {
            stopOrbit();
        }
    });

    // 3D Positioning Math & UI Updates
    function updateCoordinateMap(x, y) {
        // Map pixel coordinates inside stage to Web Audio 3D coordinates (-10 to 10)
        let stageWidth = stage.offsetWidth;
        let stageHeight = stage.offsetHeight;
        
        // Ensure x,y are within stage bounds numerically for rendering
        const clampedX = Math.max(0, Math.min(x, stageWidth));
        const clampedY = Math.max(0, Math.min(y, stageHeight));
        
        // Update DOM element position
        sourceEl.style.left = `${clampedX}px`;
        sourceEl.style.top = `${clampedY}px`;

        if (panner && audioCtx) {
            // Convert to centered coordinates where 0,0 is center of stage
            const centerX = stageWidth / 2;
            const centerY = stageHeight / 2;
            
            // Map to ~10 units distance for panner
            const maxAudioDistance = 10;
            
            const audioX = ((clampedX - centerX) / centerX) * maxAudioDistance;
            
            // Z goes into the screen (negative Z = in front)
            const audioZ = ((clampedY - centerY) / centerY) * maxAudioDistance; // Front is actually top of div (Y=0)

            // Web audio coord system: 
            // X goes right (positive)
            // Y goes up (positive) -> usually keep at 0.
            // Z goes away (negative) -> in front of listener. Behind listener is positive Z.
            const audioY = 0; 
            
            if (panner.positionX) {
                panner.positionX.setTargetAtTime(audioX, audioCtx.currentTime, 0.05);
                panner.positionY.setTargetAtTime(audioY, audioCtx.currentTime, 0.05);
                panner.positionZ.setTargetAtTime(audioZ, audioCtx.currentTime, 0.05);
            } else {
                panner.setPosition(audioX, audioY, audioZ);
            }
        }
        
        if (!autoOrbit) { // Only update angle if manual
            const dx = clampedX - stageWidth / 2;
            const dy = clampedY - stageHeight / 2;
            angle = Math.atan2(dy, dx);
        }
    }

    // Handlers
    function getEventPos(e, stageRect) {
        if(e.touches && e.touches.length > 0) {
            return {
                x: e.touches[0].clientX - stageRect.left,
                y: e.touches[0].clientY - stageRect.top
            };
        }
        return {
            x: e.clientX - stageRect.left,
            y: e.clientY - stageRect.top
        };
    }

    function handleDragstart(e) {
        if(autoOrbit) return;
        isDragging = true;
        const stageRect = stage.getBoundingClientRect();
        const pos = getEventPos(e, stageRect);
        updateCoordinateMap(pos.x, pos.y);
    }
    
    function handleDragmove(e) {
        if (!isDragging) return;
        e.preventDefault();
        const stageRect = stage.getBoundingClientRect();
        const pos = getEventPos(e, stageRect);
        updateCoordinateMap(pos.x, pos.y);
    }
    
    function handleDragend() {
        isDragging = false;
    }

    // Drag Logic
    sourceEl.addEventListener('mousedown', handleDragstart);
    stage.addEventListener('mousedown', handleDragstart);
    
    window.addEventListener('mousemove', handleDragmove);
    window.addEventListener('mouseup', handleDragend);
    
    // Touch support
    sourceEl.addEventListener('touchstart', handleDragstart, {passive: false});
    stage.addEventListener('touchstart', handleDragstart, {passive: false});

    window.addEventListener('touchmove', handleDragmove, { passive: false });
    window.addEventListener('touchend', handleDragend);

    // Auto Orbit Animation
    function startOrbit() {
        let lastTime = performance.now();
        const speed = 0.0015; // radians per ms

        function loop(currentTime) {
            if (!autoOrbit) return; // Exit loop if turned off
            const delta = currentTime - lastTime;
            lastTime = currentTime;

            angle += speed * delta;
            
            const centerX = stage.offsetWidth / 2;
            const centerY = stage.offsetHeight / 2;
            const radius = stage.offsetWidth / 2 * 0.8;
            
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;

            updateCoordinateMap(x, y);
            
            orbitAnimationId = requestAnimationFrame(loop);
        }
        orbitAnimationId = requestAnimationFrame(loop);
    }

    function stopOrbit() {
        if (orbitAnimationId) {
            cancelAnimationFrame(orbitAnimationId);
            orbitAnimationId = null;
        }
    }

    // Set initial position
    setTimeout(() => {
        sourceEl.style.left = `${stage.offsetWidth / 2}px`;
        sourceEl.style.top = `${stage.offsetHeight * 0.1}px`;
        updateCoordinateMap(stage.offsetWidth / 2, stage.offsetHeight * 0.1);
    }, 100);
});
