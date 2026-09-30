import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ARENA_CLIPS, ARENA_MODELS, MARKS, NOTCHES, POSITIONS, boltArc, burstOffsets, clipFor, gateLean, isBodyPart, notchPosition, sealNotches, shardOffsets } from "./arenaMap.js";
import { EMBER_COUNT, emberPosition, gateGlow, haloScale, idleSway, runeRing, shockwave, sparkOffsets, starPositions } from "./arenaFx.js";
import { HIT_STOP_MS, decayTrauma, markFor, shakeOffset, traumaFor, type FloorMark } from "./juice.js";
import { beatDuration, essenceColor, type Beat, type Side, type Stage, type StageHooks, type StageLive, type StageState } from "./stage.js";

/**
 * The Three.js arena (docs/duel-3d-assets-and-ui.md): a second renderer of
 * the same beats the SVG stage plays, behind the "3D arena" setting. Two
 * KayKit mages, a gate, hex wards, a bolt, an orb, floor marks; the trauma
 * dial shakes the camera. Same `Stage` interface, same beat timings, so
 * tap-to-skip and reduced motion behave identically. Text stays HTML.
 *
 * Graphics pass (docs/duel-3d-assets-and-ui.md §6 step 5, second round):
 * soft shadows and filmic tone mapping, a star dome and drifting embers, a
 * flagstone floor with rune rings, a portal veil in the gate with glowing
 * runes on the pillars, additive halos and sparks on the bolt, shockwaves
 * and soft scorch decals on impact, and a bloom pass when the device can
 * afford it (`fx: "full"`); `fx: "light"` keeps the geometry and skips the
 * post-processing, embers and shadows.
 */
export type ArenaOptions = {
    /** Where the prepared GLBs live (see scripts/prepare_arena_assets.mjs). */
    assetBase: string;
    motion: { reduced: () => boolean };
    hooks?: StageHooks;
    /** Model files per side; the opponent's can change per match (personality). */
    models: Record<Side, string>;
    /** Effects level: full (bloom, shadows, embers) or light (geometry only). Default full. */
    fx?: "full" | "light";
};

export type Arena = Stage & {
    /** Resolves when both mages are loaded; the arena renders the props before that. */
    ready: Promise<void>;
    setModel(side: Side, file: string): Promise<void>;
    dispose(): void;
};

export function supportsWebGL(): boolean {
    try {
        const canvas = document.createElement("canvas");
        return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
    } catch {
        return false;
    }
}

const ASPECT = 360 / 170;
const SIDES: readonly Side[] = ["player", "opponent"];

type Mage = {
    root: THREE.Group;
    mixer: THREE.AnimationMixer | undefined;
    actions: Map<string, THREE.AnimationAction>;
    current: THREE.AnimationAction | undefined;
};

type Tween = { start: number; ms: number; step: (t: number) => void; done: () => void };

export function createArena(container: HTMLElement, options: ArenaOptions): Arena {
    const { motion, hooks } = options;
    const dur = (ms: number): number => (motion.reduced() ? 1 : ms);

    // --- DOM: canvas, caption and flash overlays.
    const full = (options.fx ?? "full") === "full";
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = full;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.dataset.fx = full ? "full" : "light";
    container.replaceChildren();
    container.append(renderer.domElement);
    const caption = document.createElement("div");
    caption.className = "arena-caption";
    caption.id = "arena-caption";
    const flash = document.createElement("div");
    flash.className = "arena-flash";
    container.append(caption, flash);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, ASPECT, 0.1, 50);
    // Camera poses per phase (docs/duel-3d-assets-and-ui.md §3, layout A):
    // read/react push in on the opponent, shape looks over the player's
    // shoulder, cast frames both marks, resolve goes wide, verdict pulls
    // back to take in the gate. The trauma shake rides on top.
    type Pose = { at: THREE.Vector3; look: THREE.Vector3; fov: number };
    const POSES: Record<"read" | "react" | "shape" | "cast" | "resolve" | "verdict", Pose> = {
        read: { at: new THREE.Vector3(1.4, 1.9, 4.4), look: new THREE.Vector3(2.0, 1.25, 0), fov: 30 },
        react: { at: new THREE.Vector3(1.0, 1.9, 4.8), look: new THREE.Vector3(1.6, 1.2, 0), fov: 30 },
        shape: { at: new THREE.Vector3(-4.4, 2.2, 2.8), look: new THREE.Vector3(0.4, 1.2, 0), fov: 34 },
        cast: { at: new THREE.Vector3(0, 2.0, 6.4), look: new THREE.Vector3(0, 1.15, 0), fov: 30 },
        resolve: { at: new THREE.Vector3(0, 2.2, 7.0), look: new THREE.Vector3(0, 1.1, 0), fov: 32 },
        verdict: { at: new THREE.Vector3(0, 3.1, 8.2), look: new THREE.Vector3(0, 1.0, 0), fov: 30 }
    };
    const CAMERA_AT = POSES.cast.at.clone();
    const LOOK_AT = POSES.cast.look.clone();
    camera.position.copy(CAMERA_AT);
    camera.lookAt(LOOK_AT);

    scene.fog = new THREE.FogExp2(0x120b1f, 0.04);
    scene.add(new THREE.HemisphereLight(0xcbbfff, 0x241a3a, 0.9));
    const key = new THREE.DirectionalLight(0xfff1e0, 1.7);
    key.position.set(3, 6, 5);
    key.castShadow = full;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = key.shadow.camera.bottom = -6;
    key.shadow.camera.right = key.shadow.camera.top = 6;
    key.shadow.bias = -0.0015;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8a6bff, 0.7);
    rim.position.set(-4, 3, -4);
    scene.add(rim);

    // The dome: a gradient sky with a scatter of stars, well outside the fog.
    const dome = new THREE.Mesh(
        new THREE.SphereGeometry(26, 32, 16),
        new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            uniforms: { uTop: { value: new THREE.Color(0x07040f) }, uHorizon: { value: new THREE.Color(0x2a1d4a) } },
            vertexShader: "varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
            fragmentShader: "uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vPos; void main() { float h = clamp(vPos.y / 26.0, 0.0, 1.0); gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.6)), 1.0); }"
        })
    );
    scene.add(dome);
    const starGeometry = new THREE.BufferGeometry();
    const starArray = new Float32Array(160 * 3);
    starPositions(160).forEach((p, i) => starArray.set([p.x, p.y, p.z], i * 3));
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starArray, 3));
    scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xcfc4ff, size: 0.18, transparent: true, opacity: 0.8, depthWrite: false, fog: false })));

    /** A canvas texture drawn once; sRGB, so colours match the CSS palette. */
    function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) draw(ctx);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }
    /** A soft radial glow: white centre fading to transparent, tinted by the material's colour. */
    const glowTexture = canvasTexture(128, ctx => {
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.35, "rgba(255,255,255,0.55)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
    });
    const glowSprite = (color: number | string, scale: number, opacity = 0.9): THREE.Sprite => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
        sprite.scale.setScalar(scale);
        return sprite;
    };

    // Floor: flagstones with a worn arena circle, drawn once onto a canvas.
    const floorTexture = canvasTexture(1024, ctx => {
        ctx.fillStyle = "#241a3a";
        ctx.fillRect(0, 0, 1024, 1024);
        // Flagstones: an offset grid with a little jitter and darker grout.
        for (let row = 0; row < 12; row++) {
            for (let col = 0; col < 12; col++) {
                const jitter = ((row * 31 + col * 17) % 7) / 7;
                const x = col * 88 + (row % 2 ? 44 : 0) - 44;
                const y = row * 88;
                const shade = 46 + Math.floor(jitter * 22);
                ctx.fillStyle = `rgb(${shade}, ${shade - 8}, ${shade + 30})`;
                ctx.fillRect(x + 3, y + 3, 82, 82);
            }
        }
        // The arena circle: two rings and tick marks, faintly luminous.
        ctx.strokeStyle = "rgba(173, 99, 255, 0.35)";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(512, 512, 470, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(512, 512, 300, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(512 + Math.cos(a) * 455, 512 + Math.sin(a) * 455);
            ctx.lineTo(512 + Math.cos(a) * 485, 512 + Math.sin(a) * 485);
            ctx.stroke();
        }
        // A vignette so the edge sinks into the fog.
        const v = ctx.createRadialGradient(512, 512, 200, 512, 512, 520);
        v.addColorStop(0, "rgba(10, 6, 18, 0)");
        v.addColorStop(1, "rgba(10, 6, 18, 0.85)");
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, 1024, 1024);
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5.2, 64), new THREE.MeshStandardMaterial({ map: floorTexture, color: 0xffffff, roughness: 0.9, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Rune rings: small glowing slivers around each mage's mark (persona tint)
    // and a wider ring around the gate.
    const runeMaterials: Record<Side, THREE.MeshBasicMaterial> = {
        player: new THREE.MeshBasicMaterial({ color: 0xad63ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
        opponent: new THREE.MeshBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
    };
    const runeGeometry = new THREE.BoxGeometry(0.05, 0.012, 0.16);
    for (const side of SIDES) {
        for (const r of runeRing(12, 0.86)) {
            const rune = new THREE.Mesh(runeGeometry, runeMaterials[side]);
            rune.position.set(POSITIONS[side].x + r.x, 0.012, POSITIONS[side].z + r.z);
            rune.rotation.y = -r.angle;
            scene.add(rune);
        }
    }
    const gateRuneMaterial = new THREE.MeshBasicMaterial({ color: 0x8a6bff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const r of runeRing(20, 1.55)) {
        const rune = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.2), gateRuneMaterial);
        rune.position.set(r.x, 0.012, r.z);
        rune.rotation.y = -r.angle;
        scene.add(rune);
    }

    // Embers drifting through the volume (full effects only): additive points with per-ember glow.
    const emberGeometry = new THREE.BufferGeometry();
    const emberArray = new Float32Array(EMBER_COUNT * 3);
    const emberColors = new Float32Array(EMBER_COUNT * 3);
    emberGeometry.setAttribute("position", new THREE.BufferAttribute(emberArray, 3));
    emberGeometry.setAttribute("color", new THREE.BufferAttribute(emberColors, 3));
    const embers = new THREE.Points(emberGeometry, new THREE.PointsMaterial({ map: glowTexture, size: 0.09, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    embers.visible = full;
    scene.add(embers);
    const emberTint = new THREE.Color(0xffb46b);
    function placeEmbers(t: number): void {
        for (let i = 0; i < EMBER_COUNT; i++) {
            const e = emberPosition(i, t);
            emberArray.set([e.x, e.y, e.z], i * 3);
            emberColors.set([emberTint.r * e.glow, emberTint.g * e.glow, emberTint.b * e.glow], i * 3);
        }
        (emberGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        (emberGeometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    }
    placeEmbers(0);
    // The ring under each mage takes its persona's tint; the gold torus is the
    // priority rim of the mage who resolves first this round.
    const rings: Record<Side, THREE.Mesh> = { player: new THREE.Mesh(), opponent: new THREE.Mesh() };
    const priority: Record<Side, THREE.Mesh> = { player: new THREE.Mesh(), opponent: new THREE.Mesh() };
    const plates: Record<Side, THREE.Sprite> = { player: new THREE.Sprite(), opponent: new THREE.Sprite() };
    for (const side of SIDES) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.82, 48), new THREE.MeshBasicMaterial({ color: 0x5b3fd1, transparent: true, opacity: 0.35 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(POSITIONS[side].x, 0.005, POSITIONS[side].z);
        scene.add(ring);
        rings[side] = ring;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.035, 8, 48), new THREE.MeshBasicMaterial({ color: 0xf2c46b }));
        rim.rotation.x = Math.PI / 2;
        rim.position.set(POSITIONS[side].x, 0.02, POSITIONS[side].z);
        rim.visible = false;
        scene.add(rim);
        priority[side] = rim;
        const plate = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
        plate.position.set(POSITIONS[side].x, 2.55, POSITIONS[side].z);
        plate.scale.set(1.5, 0.375, 1);
        scene.add(plate);
        plates[side] = plate;
    }

    /** A nameplate texture: the title in its tint on a dark pill. */
    function labelTexture(text: string, tint: string): THREE.Texture {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.fillStyle = "rgba(20, 13, 34, 0.78)";
            ctx.beginPath();
            ctx.roundRect(24, 20, 464, 88, 44);
            ctx.fill();
            ctx.font = "700 48px 'Segoe UI', system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = tint;
            ctx.fillText(text, 256, 66);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    // The gate: two pillars, a lintel, a slab that drops when closed.
    const gate = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x3a2f55, roughness: 0.85, metalness: 0.05 });
    // Rune strips on the pillars glow with the gate's state (gateGlow).
    const gateRuneStrip = new THREE.MeshStandardMaterial({ color: 0x2a1a6a, emissive: 0xad63ff, emissiveIntensity: 0.5, roughness: 0.4 });
    for (const x of [-0.7, 0.7]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), stone);
        pillar.position.set(x, 1.3, 0);
        pillar.castShadow = full;
        gate.add(pillar);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), stone);
        cap.position.set(x, 2.55, 0);
        gate.add(cap);
        for (const y of [0.6, 1.1, 1.6, 2.1]) {
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.02), gateRuneStrip);
            strip.position.set(x, y, 0.16);
            gate.add(strip);
        }
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 0.34), stone);
    lintel.position.set(0, 2.72, 0);
    lintel.castShadow = full;
    gate.add(lintel);
    // Shards keep the old solid look; the slab itself is a portal veil: a
    // swirl of noise in the gate's violet, dense when closed, a shimmer when open.
    const slabMaterial = new THREE.MeshStandardMaterial({ color: 0x5b3fd1, emissive: 0x2a1a6a, transparent: true, opacity: 0.9, roughness: 0.4 });
    const VEIL_FRAGMENT = `
        uniform float uTime; uniform float uDensity; uniform vec3 uColor;
        varying vec2 vUv;
        float n(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(n(i), n(i + vec2(1.0, 0.0)), u.x), mix(n(i + vec2(0.0, 1.0)), n(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main() {
            vec2 p = vUv * vec2(3.0, 6.0);
            float swirl = noise(p + vec2(uTime * 0.25, -uTime * 0.4)) * 0.6 + noise(p * 2.3 - vec2(0.0, uTime * 0.7)) * 0.4;
            float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.08, vUv.y);
            float alpha = uDensity * (0.35 + 0.65 * swirl) * edge;
            vec3 color = mix(uColor, vec3(0.95, 0.9, 1.0), pow(swirl, 3.0) * 0.8);
            gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.96));
        }`;
    const veilMaterial = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uDensity: { value: 0.35 }, uColor: { value: new THREE.Color(0x6a46e6) } },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: VEIL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 2.4), veilMaterial);
    slab.position.set(0, 1.3, 0);
    gate.add(slab);
    const keystone = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({ color: 0xf4f0ff }));
    keystone.position.set(0, 2.15, 0.2);
    keystone.add(glowSprite(0xc3aeff, 0.45, 0.4));
    const keystoneLight = new THREE.PointLight(0xad63ff, 1.0, 5, 1.5);
    keystone.add(keystoneLight);
    gate.add(keystone);
    scene.add(gate);

    // Wards: hex prisms around a mage or the gate, shaded as a hex-tiled
    // shell with a fresnel glow (VFX pass); `uCrack` draws the fissures of a
    // ward at integrity 1, `uFlash` the flare of a block.
    const HEX_VERTEX = `
        varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
        void main() {
            vUv = uv; vNormal = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = -mv.xyz;
            gl_Position = projectionMatrix * mv;
        }`;
    const HEX_FRAGMENT = `
        uniform vec3 uColor; uniform float uOpacity; uniform float uCrack; uniform float uFlash; uniform float uTime;
        varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
        // Distance to the nearest hex edge on a tiled plane (axial coordinates).
        float hexEdge(vec2 p) {
            const vec2 s = vec2(1.0, 1.7320508);
            vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
            vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
            vec2 q = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? abs(h.xy) : abs(h.zw);
            return max(dot(q, s * 0.5), q.x);
        }
        void main() {
            vec2 p = vec2(vUv.x * 14.0, vUv.y * 4.0);
            float edge = hexEdge(p);
            float line = smoothstep(0.42, 0.5, edge);
            float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
            float crack = uCrack * step(0.985, fract(sin(floor(p.x * 2.0) * 7.1 + floor(p.y * 2.0) * 3.3) * 43758.5)) ;
            float pulse = 0.85 + 0.15 * sin(uTime * 3.0 + vUv.y * 6.0);
            float alpha = uOpacity * (0.35 + 0.65 * line) * pulse + fresnel * 0.35 + uFlash * 0.5 + crack * 0.6;
            vec3 color = mix(uColor, vec3(1.0), uFlash * 0.6 + crack * 0.4);
            gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.95));
        }`;
    type HexMaterial = THREE.ShaderMaterial & { uniforms: { uColor: { value: THREE.Color }; uOpacity: { value: number }; uCrack: { value: number }; uFlash: { value: number }; uTime: { value: number } } };
    const hexMaterials: HexMaterial[] = [];
    const wardMaterial = (): HexMaterial => {
        const material = new THREE.ShaderMaterial({
            vertexShader: HEX_VERTEX,
            fragmentShader: HEX_FRAGMENT,
            uniforms: { uColor: { value: new THREE.Color(0xf4f0ff) }, uOpacity: { value: 0.35 }, uCrack: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 } },
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        }) as HexMaterial;
        hexMaterials.push(material);
        return material;
    };
    const wards: Record<Side, THREE.Mesh> = { player: new THREE.Mesh(), opponent: new THREE.Mesh() };
    for (const side of SIDES) {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.3, 6, 1, true), wardMaterial());
        mesh.position.set(POSITIONS[side].x, 1.15, POSITIONS[side].z);
        mesh.visible = false;
        scene.add(mesh);
        wards[side] = mesh;
    }
    const gateWard = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 3.1, 6, 1, true), wardMaterial());
    gateWard.position.set(0, 1.55, 0);
    gateWard.visible = false;
    scene.add(gateWard);
    // A luminous ring on the floor under each standing ward, in its colour.
    const wardRings: Record<Side, THREE.Mesh> = { player: new THREE.Mesh(), opponent: new THREE.Mesh() };
    for (const side of SIDES) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.02, 48), new THREE.MeshBasicMaterial({ color: 0xf4f0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(POSITIONS[side].x, 0.015, POSITIONS[side].z);
        ring.visible = false;
        scene.add(ring);
        wardRings[side] = ring;
    }

    // Chains (BOUND): two rings around the mage.
    const chains: Record<Side, THREE.Group> = { player: new THREE.Group(), opponent: new THREE.Group() };
    for (const side of SIDES) {
        const group = chains[side];
        for (const y of [0.7, 1.15]) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 8, 32), new THREE.MeshStandardMaterial({ color: 0xa56bff, metalness: 0.6, roughness: 0.3 }));
            ring.rotation.x = Math.PI / 2;
            ring.position.set(POSITIONS[side].x, y, POSITIONS[side].z);
            group.add(ring);
        }
        group.visible = false;
        scene.add(group);
    }

    // Bolt, orb, floor marks.
    const boltMaterial = new THREE.MeshBasicMaterial({ color: 0xff7a3d });
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), boltMaterial);
    const boltLight = new THREE.PointLight(0xff7a3d, 8, 7, 1.6);
    bolt.add(boltLight);
    const boltHalo = glowSprite(0xff7a3d, 1.0, 0.95);
    bolt.add(boltHalo);
    bolt.visible = false;
    scene.add(bolt);
    // Beam clash: a beam from each hand to the knot (the bolt parked on its arc).
    const beamMeshes: Record<Side, THREE.Mesh> = {
        player: new THREE.Mesh(),
        opponent: new THREE.Mesh()
    };
    for (const side of SIDES) {
        const material = new THREE.MeshBasicMaterial({ color: 0xf4f0ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 1, 12, 1, true), material);
        mesh.visible = false;
        scene.add(mesh);
        beamMeshes[side] = mesh;
    }
    const beamUp = new THREE.Vector3(0, 1, 0);
    // Sparks shed behind the bolt in flight.
    const sparkGeometry = new THREE.BufferGeometry();
    const sparkArray = new Float32Array(14 * 3);
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkArray, 3));
    const sparkMaterial = new THREE.PointsMaterial({ map: glowTexture, color: 0xff7a3d, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
    sparks.visible = false;
    scene.add(sparks);
    // The impact: a shockwave ring facing the camera and a brief light.
    const shockMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const shock = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), shockMaterial);
    shock.visible = false;
    scene.add(shock);
    const impactLight = new THREE.PointLight(0xffffff, 0, 6, 1.4);
    scene.add(impactLight);
    async function playShock(at: THREE.Vector3, color: string, ms: number): Promise<void> {
        shockMaterial.color.set(color);
        impactLight.color.set(color);
        shock.position.copy(at);
        impactLight.position.copy(at).add(new THREE.Vector3(0, 0.2, 0.6));
        shock.visible = true;
        await tween(ms, t => {
            const w = shockwave(t);
            shock.scale.setScalar(w.radius);
            shockMaterial.opacity = w.opacity;
            impactLight.intensity = 14 * (1 - t);
        });
        shock.visible = false;
        impactLight.intensity = 0;
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), new THREE.MeshBasicMaterial({ color: 0xf4f0ff }));
    orb.add(glowSprite(0xf2c46b, 1.1, 0.9));
    orb.visible = false;
    scene.add(orb);
    // Orbs held in the hands (Quickdraw's telegraph): a core and a halo each.
    const handOrbs: Record<Side, { mesh: THREE.Mesh; halo: THREE.Sprite }> = { player: { mesh: new THREE.Mesh(), halo: new THREE.Sprite() }, opponent: { mesh: new THREE.Mesh(), halo: new THREE.Sprite() } };
    for (const side of SIDES) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), new THREE.MeshBasicMaterial({ color: 0xf4f0ff }));
        const halo = glowSprite(0xf4f0ff, 0.8, 0.9);
        mesh.add(halo);
        mesh.position.set(POSITIONS[side].x + (side === "player" ? 0.55 : -0.55), 1.25, 0);
        mesh.visible = false;
        scene.add(mesh);
        handOrbs[side] = { mesh, halo };
    }
    // Soft scorch decal for the floor marks (a radial fade instead of a hard disc).
    const scorchTexture = canvasTexture(128, ctx => {
        const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
        g.addColorStop(0, "rgba(255,255,255,0.9)");
        g.addColorStop(0.5, "rgba(255,255,255,0.35)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
    });
    const marks = new THREE.Group();
    scene.add(marks);

    // Mages.
    const loader = new GLTFLoader();
    const mages: Record<Side, Mage> = {
        player: { root: new THREE.Group(), mixer: undefined, actions: new Map(), current: undefined },
        opponent: { root: new THREE.Group(), mixer: undefined, actions: new Map(), current: undefined }
    };
    for (const side of SIDES) {
        mages[side].root.position.set(POSITIONS[side].x, 0, POSITIONS[side].z);
        scene.add(mages[side].root);
    }

    const showOverride: Partial<Record<Side, readonly string[]>> = {};

    async function setModel(side: Side, file: string): Promise<void> {
        const gltf = await loader.loadAsync(options.assetBase + file);
        const mage = mages[side];
        mage.root.clear();
        mage.actions.clear();
        mage.current = undefined;
        const model = gltf.scene;
        // Normalise to ~1.9 m tall whatever the pack's units.
        const box = new THREE.Box3().setFromObject(model);
        const height = Math.max(0.01, box.max.y - box.min.y);
        model.scale.setScalar(1.9 / height);
        model.position.y = -box.min.y * (1.9 / height);
        // Face the other mage; a faint emissive tint tells the two apart.
        model.rotation.y = side === "player" ? Math.PI / 2 : -Math.PI / 2;
        const spec = ARENA_MODELS[file];
        const tint = spec?.tint ?? 0xffffff;
        model.traverse(object => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.frustumCulled = false;
            // One file carries every weapon variant; show the body and the listed props only.
            const show = showOverride[side] ?? spec?.show ?? [];
            if (spec) mesh.visible = isBodyPart(mesh.name, spec) || show.includes(mesh.name);
            mesh.castShadow = full;
            const material = mesh.material as THREE.MeshStandardMaterial;
            if (material && "emissive" in material) {
                material.emissive = new THREE.Color(tint);
                material.emissiveIntensity = 0.12;
            }
        });
        mage.root.add(model);
        mage.mixer = new THREE.AnimationMixer(model);
        for (const clip of gltf.animations) mage.actions.set(clip.name, mage.mixer.clipAction(clip));
        playClip(side, ARENA_CLIPS.idle, true);
    }

    function playClip(side: Side, name: string, loop: boolean): void {
        const mage = mages[side];
        const next = mage.actions.get(name) ?? mage.actions.get(ARENA_CLIPS.idle);
        if (!next || !mage.mixer) return;
        next.reset();
        next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        next.clampWhenFinished = !loop;
        next.enabled = true;
        if (mage.current && mage.current !== next) {
            next.crossFadeFrom(mage.current, motion.reduced() ? 0 : 0.15, false);
        }
        next.play();
        mage.current = next;
        if (!loop) {
            // Back to idle when the one-shot ends.
            const onFinished = (event: { action: THREE.AnimationAction }): void => {
                if (event.action !== next) return;
                mage.mixer?.removeEventListener("finished", onFinished as never);
                if (mage.current === next) playClip(side, ARENA_CLIPS.idle, true);
            };
            mage.mixer.addEventListener("finished", onFinished as never);
        }
    }

    const ready = Promise.all(SIDES.map(side => setModel(side, options.models[side]))).then(() => undefined);

    // --- Frame loop: mixers, tweens, trauma, render.
    const clock = new THREE.Clock();
    const tweens: Tween[] = [];
    let trauma = 0;
    let frame = 0;
    let disposed = false;
    // Bloom (full effects): the halos, runes and veil glow past their edges.
    // The composer renders at the canvas size; the bloom pass works on a
    // quarter-resolution chain, cheap enough for a phone.
    let composer: EffectComposer | undefined;
    let bloom: UnrealBloomPass | undefined;
    if (full) {
        try {
            composer = new EffectComposer(renderer);
            composer.addPass(new RenderPass(scene, camera));
            bloom = new UnrealBloomPass(new THREE.Vector2(256, 128), 0.55, 0.6, 0.72);
            composer.addPass(bloom);
            composer.addPass(new OutputPass());
        } catch {
            composer = undefined;
        }
    }
    function resize(): void {
        const width = Math.max(1, container.clientWidth);
        const height = Math.round(width / ASPECT);
        renderer.setSize(width, height, false);
        composer?.setSize(width, height);
        bloom?.setSize(Math.round(width / 2), Math.round(height / 2));
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : undefined;
    observer?.observe(container);

    function tick(): void {
        if (disposed) return;
        frame = requestAnimationFrame(tick);
        const delta = clock.getDelta();
        const now = performance.now();
        const seconds = now / 1000;
        for (const material of hexMaterials) material.uniforms.uTime.value = seconds;
        veilMaterial.uniforms.uTime!.value = seconds;
        const glow = gateGlow(gateState, seconds);
        gateRuneStrip.emissiveIntensity = glow;
        keystoneLight.intensity = 0.3 + glow * 0.6;
        if (embers.visible && !motion.reduced()) placeEmbers(seconds);
        // The trail follows the bolt while it flies and fades when it stops;
        // sparks scatter behind it.
        if (bolt.visible) {
            trailHistory.unshift(bolt.position.clone());
            if (trailHistory.length > trail.length) trailHistory.length = trail.length;
            const dir: 1 | -1 = (trailHistory[1]?.x ?? bolt.position.x) <= bolt.position.x ? 1 : -1;
            sparks.visible = true;
            sparks.position.copy(bolt.position);
            sparkMaterial.color.copy(boltMaterial.color);
            sparkOffsets(14, seconds, dir).forEach((o, i) => sparkArray.set([o.x, o.y, o.z], i * 3));
            (sparkGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        } else {
            sparks.visible = false;
            if (trailHistory.length > 0) trailHistory.shift();
        }
        trail.forEach((ghost, i) => {
            const p = trailHistory[i];
            ghost.visible = p !== undefined;
            if (p) ghost.position.copy(p);
            (ghost.material as THREE.SpriteMaterial).color.copy(boltMaterial.color);
        });
        for (const side of SIDES) mages[side].mixer?.update(delta);
        for (let i = tweens.length - 1; i >= 0; i--) {
            const tween = tweens[i] as Tween;
            const t = Math.min(1, (now - tween.start) / tween.ms);
            tween.step(t);
            if (t >= 1) {
                tweens.splice(i, 1);
                tween.done();
            }
        }
        trauma = decayTrauma(trauma, delta * 1000);
        const shake = shakeOffset(trauma, now);
        const sway = motion.reduced() ? { x: 0, y: 0 } : idleSway(seconds);
        camera.position.set(CAMERA_AT.x + shake.x * 0.03 + sway.x, CAMERA_AT.y + shake.y * 0.03 + sway.y, CAMERA_AT.z);
        camera.lookAt(LOOK_AT);
        camera.rotation.z = (shake.rot * Math.PI) / 180;
        if (composer) composer.render();
        else renderer.render(scene, camera);
    }

    let cameraPhase: keyof typeof POSES = "cast";
    function setPhase(phase: keyof typeof POSES): void {
        if (phase === cameraPhase) return;
        cameraPhase = phase;
        container.dataset.camera = phase;
        const from = { at: CAMERA_AT.clone(), look: LOOK_AT.clone(), fov: camera.fov };
        const to = POSES[phase];
        void tween(650, t => {
            const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
            CAMERA_AT.lerpVectors(from.at, to.at, e);
            LOOK_AT.lerpVectors(from.look, to.look, e);
            camera.fov = from.fov + (to.fov - from.fov) * e;
            camera.updateProjectionMatrix();
        });
    }

    function addTrauma(amount: number): void {
        if (amount <= 0 || motion.reduced()) return;
        trauma = Math.min(1, trauma + amount);
    }

    function tween(ms: number, step: (t: number) => void): Promise<void> {
        const length = dur(ms);
        if (length <= 1) {
            step(1);
            return Promise.resolve();
        }
        return new Promise(resolve => tweens.push({ start: performance.now(), ms: length, step, done: resolve }));
    }
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, dur(ms)));

    function say(text: string): void {
        caption.textContent = text;
    }

    function pulseFlash(opacity: number, ms: number): void {
        flash.style.transition = "none";
        flash.style.opacity = String(opacity);
        requestAnimationFrame(() => {
            flash.style.transition = `opacity ${dur(ms)}ms ease-out`;
            flash.style.opacity = "0";
        });
    }

    // --- Board state.
    function drawWard(side: Side, ward: StageState["wards"][Side]): void {
        const mesh = wards[side];
        mesh.visible = ward !== undefined;
        wardRings[side].visible = ward !== undefined;
        if (!ward) return;
        const material = mesh.material as HexMaterial;
        material.uniforms.uColor.value.set(essenceColor(ward.essence));
        material.uniforms.uOpacity.value = ward.integrity === 1 ? 0.22 : 0.35;
        material.uniforms.uCrack.value = ward.integrity === 1 ? 1 : 0;
        (wardRings[side].material as THREE.MeshBasicMaterial).color.set(essenceColor(ward.essence));
    }
    function drawGateWard(ward: StageState["gateWard"]): void {
        gateWard.visible = ward !== undefined;
        if (!ward) return;
        const material = gateWard.material as HexMaterial;
        material.uniforms.uColor.value.set(ward.ownerId === "player" ? 0xad63ff : 0xff7a3d);
        material.uniforms.uOpacity.value = ward.integrity === 1 ? 0.22 : 0.35;
        material.uniforms.uCrack.value = ward.integrity === 1 ? 1 : 0;
    }
    /** A block flares the shell; `t` in [0, 1] over the beat. */
    function flareWard(mesh: THREE.Mesh, t: number): void {
        (mesh.material as HexMaterial).uniforms.uFlash.value = Math.sin(Math.PI * t);
    }
    function fadeWard(mesh: THREE.Mesh, t: number): void {
        (mesh.material as HexMaterial).uniforms.uOpacity.value = 0.35 * (1 - t);
    }

    // --- Scoreboard: chains with notches, the gate's lean.
    const chainMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7db0, metalness: 0.5, roughness: 0.5 });
    const notchMeshes: Record<Side, THREE.Mesh[]> = { player: [], opponent: [] };
    for (const side of SIDES) {
        for (let i = 0; i < 7; i++) {
            const link = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 6, 12), chainMaterial);
            const dir = side === "player" ? -1 : 1;
            link.position.set(dir * (0.95 + i * 0.2), 1.9, 0);
            link.rotation.y = i % 2 ? Math.PI / 2 : 0;
            scene.add(link);
        }
        for (let i = 0; i < NOTCHES; i++) {
            const notch = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), new THREE.MeshStandardMaterial({ color: 0x3a2f55, emissive: 0xf2c46b, emissiveIntensity: 0 }));
            const p = notchPosition(side, i);
            notch.position.set(p.x, p.y, p.z);
            scene.add(notch);
            notchMeshes[side].push(notch);
        }
    }
    let shownSeals: Record<Side, number> = { player: 0, opponent: 0 };
    function drawSeals(seals: Record<Side, number>): void {
        shownSeals = { ...seals };
        container.dataset.seals = `${seals.player}-${seals.opponent}`;
        for (const notch of sealNotches(seals)) {
            const mesh = notchMeshes[notch.side][notch.index];
            if (mesh) (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = notch.lit ? 1.6 : 0;
        }
        gate.rotation.z = gateLean(seals);
    }

    // --- Bolt trail, impact bursts, gate shards.
    const trail: THREE.Sprite[] = [];
    for (let i = 0; i < 8; i++) {
        const ghost = glowSprite(0xff7a3d, 0.75 - i * 0.07, 0.5 - i * 0.055);
        ghost.visible = false;
        scene.add(ghost);
        trail.push(ghost);
    }
    const trailHistory: THREE.Vector3[] = [];
    const burstGeometry = new THREE.BufferGeometry();
    burstGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    const burstMaterial = new THREE.PointsMaterial({ map: glowTexture, color: 0xffffff, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const burst = new THREE.Points(burstGeometry, burstMaterial);
    burst.visible = false;
    scene.add(burst);
    async function playBurst(at: THREE.Vector3, color: string, ms: number): Promise<void> {
        burstMaterial.color.set(color);
        burst.position.copy(at);
        burst.visible = true;
        await tween(ms, t => {
            const positions = burstGeometry.getAttribute("position") as THREE.BufferAttribute;
            burstOffsets(16, t).forEach((o, i) => positions.setXYZ(i, o.x, o.y, o.z));
            positions.needsUpdate = true;
            burstMaterial.opacity = 0.9 * (1 - t);
        });
        burst.visible = false;
    }
    const shards: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
        const shard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.12), slabMaterial);
        shard.visible = false;
        scene.add(shard);
        shards.push(shard);
    }
    const SHARD_HOME = [
        [-0.3, 2.1], [0.3, 2.1], [-0.3, 1.3], [0.3, 1.3], [-0.3, 0.55], [0.3, 0.55]
    ] as const;
    function placeShards(t: number): void {
        shardOffsets(shards.length, t).forEach((o, i) => {
            const shard = shards[i] as THREE.Mesh;
            const home = SHARD_HOME[i] as readonly [number, number];
            shard.position.set(home[0] + o.x, Math.max(0.06, home[1] + o.y), o.z);
            shard.rotation.set(o.spin * 0.6, o.spin, o.spin * 0.3);
        });
    }
    let shardsOut = false;
    let gateState: StageState["gate"] = "open";
    function showShards(out: boolean): void {
        shardsOut = out;
        for (const shard of shards) shard.visible = out;
        if (out) placeShards(1);
    }
    function drawGate(state: StageState["gate"]): void {
        gateState = state;
        slab.position.y = state === "closed" ? 1.3 : 3.55;
        slab.visible = state === "closed";
        veilMaterial.uniforms.uDensity!.value = state === "closed" ? 0.95 : 0;
        gate.rotation.z = state === "broken" ? 0.08 : 0;
        keystone.visible = state !== "broken";
    }
    function addMark(mark: FloorMark): void {
        const own = marks.children.filter(m => m.userData.side === mark.side);
        if (own.length >= 8) own[0]?.removeFromParent();
        const disc = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: scorchTexture, color: essenceColor(mark.essence), transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
        disc.rotation.x = -Math.PI / 2;
        const jitter = ((own.length * 7919) % 17) / 17 - 0.5;
        disc.position.set(MARKS[mark.side].x + jitter * 0.9, 0.01 + own.length * 0.001, MARKS[mark.side].z + jitter * 0.4);
        disc.userData.side = mark.side;
        marks.add(disc);
    }

    function setIdle(state: StageState): void {
        drawSeals(state.seals ?? { player: 0, opponent: 0 });
        for (const side of SIDES) {
            drawWard(side, state.wards[side]);
            (wards[side].material as HexMaterial).uniforms.uFlash.value = 0;
            chains[side].visible = state.bound[side];
        }
        drawGate(state.gate);
        showShards(state.gate === "broken");
        drawGateWard(state.gateWard);
        bolt.visible = false;
        orb.visible = false;
        say("");
    }

    // --- Beats.
    async function flyBolt(from: Side, to: Side, essence: string | undefined, magnitude: number, ms: number): Promise<void> {
        const color = new THREE.Color(essenceColor(essence));
        boltMaterial.color.copy(color);
        boltLight.color.copy(color);
        (boltHalo.material as THREE.SpriteMaterial).color.copy(color);
        boltHalo.scale.setScalar(haloScale(magnitude));
        bolt.scale.setScalar(0.7 + magnitude * 0.35);
        bolt.visible = true;
        await tween(ms, t => {
            const p = boltArc(from, to, t);
            bolt.position.set(p.x, p.y, p.z);
        });
    }

    async function playBeat(beat: Beat, state: StageState, essence: string | undefined): Promise<void> {
        hooks?.onBeat?.(beat);
        addTrauma(traumaFor(beat));
        const clip = clipFor(beat);
        if (clip) playClip(clip.side, clip.name, clip.loop === true);
        const ms = beatDuration(beat);
        switch (beat.kind) {
            case "cast":
                say(`${beat.side === "player" ? "◀" : "▶"} ${beat.spell}`);
                return wait(ms);
            case "fly":
                return flyBolt(beat.from, beat.to, beat.essence, beat.magnitude, ms);
            case "reflect":
                say("REFLECT");
                pulseFlash(0.25, ms);
                return tween(ms, t => bolt.scale.setScalar(1 + Math.sin(Math.PI * t) * 0.6));
            case "silence":
                say("SILENCE");
                return tween(ms, t => bolt.scale.setScalar(Math.max(0.5, 1 - t * 0.5)));
            case "null":
                say("NULL");
                await tween(ms, t => bolt.scale.setScalar(Math.max(0.01, 1 - t)));
                bolt.visible = false;
                return;
            case "split":
                say("SPLIT ×2");
                return wait(ms);
            case "reverse":
                say(beat.to ? `REVERSE → ${beat.to}` : "REVERSE");
                return wait(ms);
            case "ward-up":
                say("WARD");
                drawWard(beat.side, { ...(beat.essence ? { essence: beat.essence } : {}), ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                return tween(ms, t => wards[beat.side].scale.set(0.4 + 0.6 * t, 0.4 + 0.6 * t, 0.4 + 0.6 * t));
            case "ward-block": {
                say(beat.broken ? "WARD SHATTERS" : "WARDED");
                bolt.visible = false;
                void playBurst(new THREE.Vector3(POSITIONS[beat.side].x + (beat.side === "player" ? 0.9 : -0.9), 1.3, 0), essenceColor(essence), ms);
                void playShock(new THREE.Vector3(POSITIONS[beat.side].x + (beat.side === "player" ? 0.95 : -0.95), 1.3, 0), essenceColor(essence), ms);
                if (beat.broken) {
                    await tween(ms, t => {
                        wards[beat.side].scale.setScalar(1 + t * 0.5);
                        fadeWard(wards[beat.side], t);
                    });
                    wards[beat.side].visible = false;
                    wards[beat.side].scale.setScalar(1);
                } else {
                    await tween(ms, t => flareWard(wards[beat.side], t));
                    drawWard(beat.side, { ...state.wards[beat.side], ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                }
                return;
            }
            case "ward-break":
                say("WARD BROKEN");
                bolt.visible = false;
                void playBurst(new THREE.Vector3(POSITIONS[beat.side].x, 1.3, 0), "#f4f0ff", ms);
                await tween(ms, t => {
                    wards[beat.side].scale.setScalar(1 + t * 0.6);
                    fadeWard(wards[beat.side], t);
                });
                wards[beat.side].visible = false;
                wards[beat.side].scale.setScalar(1);
                return;
            case "mend":
                say("MEND");
                bolt.visible = false;
                if (state.wards[beat.side]) drawWard(beat.side, { ...state.wards[beat.side], integrity: 2 });
                return wait(ms);
            case "bind":
                say("BOUND");
                bolt.visible = false;
                chains[beat.side].visible = true;
                return tween(ms, t => chains[beat.side].scale.setScalar(1.6 - 0.6 * t));
            case "gate-close":
                say("GATE CLOSED");
                slab.visible = true;
                await tween(ms, t => {
                    slab.position.y = 3.55 - 2.25 * t;
                    veilMaterial.uniforms.uDensity!.value = 0.2 + 0.75 * t;
                });
                drawGate("closed");
                return;
            case "gate-open":
                say("GATE OPENED");
                await tween(ms, t => {
                    slab.position.y = 1.3 + 2.25 * t;
                    veilMaterial.uniforms.uDensity!.value = 0.95 * (1 - t);
                });
                drawGate("open");
                return;
            case "gate-break": {
                say("GATE SHATTERS");
                pulseFlash(0.2, ms);
                void playShock(new THREE.Vector3(0, 1.4, 0.3), "#c3aeff", ms);
                // The slab breaks into shards that fall and scatter; they stay while the gate is broken.
                slab.visible = false;
                showShards(true);
                void playBurst(new THREE.Vector3(0, 1.4, 0.2), "#c3aeff", ms);
                const lean = gate.rotation.z;
                await tween(ms, t => {
                    placeShards(t);
                    gate.rotation.z = lean + Math.sin(t * Math.PI * 3) * 0.06;
                });
                gate.rotation.z = lean;
                drawGate("broken");
                return;
            }
            case "gate-mend":
                say("GATE MENDED");
                // The shards fly home and the slab is whole again.
                if (shardsOut) await tween(ms, t => placeShards(1 - t));
                showShards(false);
                drawGate("open");
                return;
            case "gate-ward-up":
                say("GATE WARDED");
                drawGateWard({ ownerId: beat.side, ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                return tween(ms, t => gateWard.scale.setScalar(0.4 + 0.6 * t));
            case "gate-ward-block":
                say(beat.broken ? "GATE WARD SHATTERS" : "GATE WARD HOLDS");
                bolt.visible = false;
                await tween(ms, t => (beat.broken ? fadeWard(gateWard, t) : flareWard(gateWard, t)));
                if (beat.broken) gateWard.visible = false;
                else if (state.gateWard) drawGateWard({ ...state.gateWard, ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                (gateWard.material as HexMaterial).uniforms.uFlash.value = 0;
                return;
            case "gate-ward-break":
                say("GATE WARD BROKEN");
                await tween(ms, t => fadeWard(gateWard, t));
                gateWard.visible = false;
                return;
            case "hit": {
                const long = beat.emphasis === "decisive";
                say(beat.damage ? `HIT −${beat.damage} RESOLVE` : long ? "HIT!" : "HIT");
                // Hit-stop: the bolt hangs at the hand, then flash and kick.
                await wait(long ? HIT_STOP_MS * 2 : HIT_STOP_MS);
                bolt.visible = false;
                pulseFlash(0.35, ms);
                void playBurst(new THREE.Vector3(POSITIONS[beat.side].x, 1.25, 0.2), essenceColor(essence), ms);
                void playShock(new THREE.Vector3(POSITIONS[beat.side].x, 1.25, 0.3), essenceColor(essence), ms);
                const root = mages[beat.side].root;
                const kick = (beat.side === "player" ? -1 : 1) * (beat.magnitude >= 2 ? 0.35 : 0.22);
                await tween(ms, t => (root.position.x = POSITIONS[beat.side].x + Math.sin(Math.PI * t) * kick));
                root.position.x = POSITIONS[beat.side].x;
                const mark = markFor(beat, essence);
                if (mark) addMark(mark);
                return;
            }
            case "seal": {
                const long = beat.emphasis === "decisive";
                say(long ? `SEAL → ${beat.side === "player" ? "◀" : "▶"} · DECISIVE` : `SEAL → ${beat.side === "player" ? "◀" : "▶"}`);
                orb.visible = true;
                // To the next notch on the scorer's chain; it lights and the gate leans.
                const notch = notchPosition(beat.side, Math.min(NOTCHES - 1, shownSeals[beat.side]));
                await tween(ms, t => {
                    orb.position.set(notch.x * t, 2.15 + Math.sin(Math.PI * t) * 0.9 - (2.15 - notch.y) * t, 0.2);
                    orb.scale.setScalar(0.6 + 0.4 * t);
                });
                orb.visible = false;
                drawSeals({ ...shownSeals, [beat.side]: shownSeals[beat.side] + 1 });
                if (long) addTrauma(0.4);
                return;
            }
            case "fizzle":
                say("FIZZLE");
                bolt.visible = false;
                return wait(ms);
            default:
                return wait(ms);
        }
    }

    let generation = 0;
    async function play(beats: Beat[], state: StageState): Promise<void> {
        const mine = ++generation;
        let essence: string | undefined;
        for (const beat of beats) {
            if (mine !== generation) return;
            if (beat.kind === "fly" || beat.kind === "cast") essence = beat.essence;
            await playBeat(beat, state, essence);
        }
        if (mine === generation) {
            await wait(300);
            say("");
            bolt.visible = false;
        }
    }

    function setPersona(side: Side, persona: { title: string; tint: string; model: string; show: readonly string[] }): void {
        showOverride[side] = persona.show;
        container.dataset[side === "player" ? "personaPlayer" : "personaOpponent"] = persona.title;
        (rings[side].material as THREE.MeshBasicMaterial).color.set(persona.tint);
        runeMaterials[side].color.set(persona.tint);
        const material = plates[side].material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.map = labelTexture(persona.title, persona.tint);
        material.needsUpdate = true;
        void setModel(side, persona.model);
    }

    function setPriority(side: Side | undefined): void {
        for (const s of SIDES) priority[s].visible = s === side;
    }

    function dispose(): void {
        disposed = true;
        cancelAnimationFrame(frame);
        observer?.disconnect();
        composer?.dispose();
        renderer.dispose();
        container.replaceChildren();
    }

    // Start the frame loop once everything it touches exists.
    tick();

    // Volley: the bolt placed frame by frame, bursts and shockwaves on demand,
    // the priority rim as the return-window ring.
    const live: StageLive = {
        bolt: b => {
            if (!b) {
                bolt.visible = false;
                return;
            }
            const color = new THREE.Color(essenceColor(b.essence));
            boltMaterial.color.copy(color);
            boltLight.color.copy(color);
            (boltHalo.material as THREE.SpriteMaterial).color.copy(color);
            boltHalo.scale.setScalar(haloScale(b.magnitude) * (1 + (b.speed - 1) * 0.08));
            bolt.scale.setScalar(0.7 + b.magnitude * 0.35);
            const p = boltArc(b.from, b.to, b.t);
            bolt.position.set(p.x, p.y, p.z);
            bolt.visible = true;
        },
        burst: (side, essence, kind) => {
            const at = new THREE.Vector3(POSITIONS[side].x + (side === "player" ? 0.6 : -0.6), 1.25, 0.2);
            const color = essenceColor(essence);
            if (kind === "hit") {
                addTrauma(0.45);
                pulseFlash(0.3, 260);
                void playBurst(at, color, 320);
                void playShock(at, color, 320);
                const root = mages[side].root;
                const kick = (side === "player" ? -1 : 1) * 0.25;
                void tween(260, t => (root.position.x = POSITIONS[side].x + Math.sin(Math.PI * t) * kick)).then(() => (root.position.x = POSITIONS[side].x));
                playClip(side, ARENA_CLIPS.hit, false);
            } else if (kind === "block" || kind === "shatter") {
                addTrauma(0.2);
                void playBurst(at, color, 260);
                void tween(260, t => flareWard(wards[side], t));
                playClip(side, ARENA_CLIPS.blockHit, false);
                if (kind === "shatter") wards[side].visible = false;
            } else {
                // quench, kindle: a flare in the returning colour and the cast swing.
                void playBurst(at, color, 220);
                playClip(side, kind === "kindle" ? ARENA_CLIPS.castLong : ARENA_CLIPS.cast, false);
            }
        },
        window: (side, open) => {
            priority[side].visible = open;
        },
        orb: (side, held) => {
            const { mesh, halo } = handOrbs[side];
            if (!held) {
                mesh.visible = false;
                return;
            }
            const color = new THREE.Color(essenceColor(held.essence));
            (mesh.material as THREE.MeshBasicMaterial).color.copy(color);
            (halo.material as THREE.SpriteMaterial).color.copy(color);
            mesh.scale.setScalar(0.6 + held.magnitude * 0.4);
            halo.scale.setScalar(haloScale(held.magnitude));
            mesh.visible = true;
        },
        gate: (offset, temper) => {
            // The rail runs from the middle to a step short of either mage.
            gate.position.x = Math.max(-1, Math.min(1, offset)) * (POSITIONS.opponent.x - 0.9);
            gateRuneStrip.emissive.set(temper ? essenceColor(temper) : 0xad63ff);
        },
        beams: b => {
            for (const side of SIDES) {
                const mesh = beamMeshes[side];
                if (!b) {
                    mesh.visible = false;
                    continue;
                }
                const a = boltArc("player", "opponent", side === "player" ? 0 : 1);
                const k = boltArc("player", "opponent", b.t);
                const from = new THREE.Vector3(a.x, a.y, a.z);
                const to = new THREE.Vector3(k.x, k.y, k.z);
                const span = to.clone().sub(from);
                const length = Math.max(0.001, span.length());
                // A unit cylinder along y, stretched between the hand and the knot.
                mesh.position.copy(from).addScaledVector(span, 0.5);
                mesh.quaternion.setFromUnitVectors(beamUp, span.normalize());
                mesh.scale.set(1, length, 1);
                (mesh.material as THREE.MeshBasicMaterial).color.set(essenceColor(b[side]));
                mesh.visible = true;
            }
        },
        caption: say
    };

    return {
        setIdle,
        setPhase,
        setPersona,
        setPriority,
        play,
        clearMarks: () => marks.clear(),
        reducedMotion: () => motion.reduced(),
        live,
        ready,
        setModel,
        dispose
    };
}
