import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ARENA_CLIPS, ARENA_MODELS, POSITIONS, isBodyPart } from "./arenaMap.js";

export type RuneArenaCamera = "behind" | "side" | "top" | "abstract";
export type ArenaRune = "line" | "arc" | "circle" | "triangle" | "spiral" | "unknown";
export type RuneArena = {
    setCamera(view: RuneArenaCamera): void;
    orbit(deltaYaw: number, deltaPitch: number): void;
    zoom(delta: number): void;
    resetCamera(): void;
    showOpponentRune(rune: ArenaRune, visible: boolean): void;
    pulseOpponentCast(): void;
    presentSpell(side: "player"|"opponent", rune: ArenaRune): void;
    presentHit(side: "player"|"opponent", amount: number): void;
    dispose(): void;
};

const cameraPoses: Record<RuneArenaCamera, { at: [number,number,number]; look: [number,number,number]; fov: number }> = {
    behind: { at: [-5.8,2.65,3.9], look: [0,1.05,0], fov: 38 },
    side: { at: [0,2.45,7.2], look: [0,1.05,0], fov: 34 },
    top: { at: [0,9.6,1.3], look: [0,0.8,0], fov: 42 },
    abstract: { at: [0,2.45,7.2], look: [0,1.05,0], fov: 34 }
};

function runePoints(rune: ArenaRune): THREE.Vector3[] {
    const p: THREE.Vector3[] = [];
    if (rune === "line") return [new THREE.Vector3(-.62,0,0), new THREE.Vector3(.62,0,0)];
    if (rune === "arc") for (let i=0;i<=24;i++){const a=Math.PI+(Math.PI*i/24);p.push(new THREE.Vector3(Math.cos(a)*.62,Math.sin(a)*.48,0));}
    if (rune === "circle") for (let i=0;i<=36;i++){const a=Math.PI*2*i/36;p.push(new THREE.Vector3(Math.cos(a)*.56,Math.sin(a)*.56,0));}
    if (rune === "triangle") return [new THREE.Vector3(0,.62,0),new THREE.Vector3(-.58,-.45,0),new THREE.Vector3(.58,-.45,0),new THREE.Vector3(0,.62,0)];
    if (rune === "spiral") for (let i=0;i<=24;i++){const a=Math.PI*i/24;p.push(new THREE.Vector3(-.62+1.24*i/24,-Math.sin(a)*.48,0));}
    return p;
}

export function createRuneArena(container: HTMLElement): RuneArena {
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:"low-power" });
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.15;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.domElement.className="rune-arena-canvas";
    container.prepend(renderer.domElement);

    const scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x120b1f,.04);
    scene.add(new THREE.HemisphereLight(0xcbbfff,0x241a3a,.9));
    const key=new THREE.DirectionalLight(0xfff1e0,1.7); key.position.set(3,6,5); key.castShadow=true; scene.add(key);
    const rim=new THREE.DirectionalLight(0x8a6bff,.7); rim.position.set(-4,3,-4); scene.add(rim);
    const camera=new THREE.PerspectiveCamera(30,1,.1,50);

    const floor=new THREE.Mesh(new THREE.CircleGeometry(5.2,64),new THREE.MeshStandardMaterial({color:0x241a3a,roughness:.9,metalness:.05}));
    floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
    for(const radius of [2.4,4.6]){const ring=new THREE.Mesh(new THREE.RingGeometry(radius,radius+.025,64),new THREE.MeshBasicMaterial({color:0x8a6bff,transparent:true,opacity:.3,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.012;scene.add(ring);}

    const loader=new GLTFLoader();
    const mageRoots: Record<"player"|"opponent",THREE.Group>={player:new THREE.Group(),opponent:new THREE.Group()};
    const mixers: THREE.AnimationMixer[]=[];
    function load(side:"player"|"opponent",file:string){
        loader.load("./assets/arena/"+file,gltf=>{
            const root=gltf.scene; const model=ARENA_MODELS[file]!;
            root.traverse(o=>{if(o instanceof THREE.Mesh){o.visible=isBodyPart(o.name,model)||model.show.includes(o.name);o.castShadow=true;o.receiveShadow=true;}});
            root.position.set(POSITIONS[side].x,0,POSITIONS[side].z); if(side==="opponent")root.rotation.y=Math.PI;
            scene.remove(mageRoots[side]); mageRoots[side]=root; scene.add(root);
            const mixer=new THREE.AnimationMixer(root);mixers.push(mixer);const clip=gltf.animations.find(x=>x.name===ARENA_CLIPS.idle);if(clip)mixer.clipAction(clip).play();
        });
    }
    load("player","mage.glb"); load("opponent","mage.glb");

    const runeGroup=new THREE.Group(); runeGroup.position.set(POSITIONS.opponent.x,1.55,POSITIONS.opponent.z+.48); scene.add(runeGroup);
    const glow=new THREE.PointLight(0xff7a3d,0,3); runeGroup.add(glow);
    let currentView:RuneArenaCamera="behind", runeVisible=false, pulseUntil=0;
    const cameraTarget=new THREE.Vector3(0,1.05,0);
    let cameraDistance=7, cameraYaw=0, cameraPitch=.28;
    let dragPointer:number|undefined, lastX=0,lastY=0;
    const activePointers=new Map<number,{x:number;y:number}>(); let pinchDistance=0;
    const bolts: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; start: number; ms: number }[]=[];
    let hitFlash:{side:"player"|"opponent";until:number}|undefined;

    function setRune(rune:ArenaRune){
        runeGroup.clear(); runeGroup.add(glow);
        const pts=runePoints(rune); if(pts.length<2)return;
        const geom=new THREE.BufferGeometry().setFromPoints(pts);
        const line=new THREE.Line(geom,new THREE.LineBasicMaterial({color:0xffb06b,transparent:true,opacity:.98,blending:THREE.AdditiveBlending,depthWrite:false}));
        runeGroup.add(line);
        for(const pt of pts.filter((_,i)=>i%6===0)){const spark=new THREE.Mesh(new THREE.SphereGeometry(.025,6,6),new THREE.MeshBasicMaterial({color:0xffe4c2}));spark.position.copy(pt);runeGroup.add(spark);}
    }
    function showOpponentRune(rune:ArenaRune,visible:boolean){setRune(rune);runeVisible=visible;runeGroup.visible=visible;container.dataset.opponentRuneVisible=String(visible);container.dataset.opponentRune=rune;}
    function applyCamera(){
        const horizontal=Math.cos(cameraPitch)*cameraDistance;
        camera.position.set(cameraTarget.x+Math.sin(cameraYaw)*horizontal,cameraTarget.y+Math.sin(cameraPitch)*cameraDistance,cameraTarget.z+Math.cos(cameraYaw)*horizontal);
        camera.lookAt(cameraTarget);camera.updateProjectionMatrix();
        container.dataset.cameraDistance=cameraDistance.toFixed(2);container.dataset.cameraYaw=cameraYaw.toFixed(3);
    }
    function setCamera(view:RuneArenaCamera){currentView=view;const p=cameraPoses[view];const at=new THREE.Vector3(...p.at),look=new THREE.Vector3(...p.look),d=at.clone().sub(look);cameraTarget.copy(look);cameraDistance=d.length();cameraYaw=Math.atan2(d.x,d.z);cameraPitch=Math.asin(THREE.MathUtils.clamp(d.y/cameraDistance,-.99,.99));camera.fov=p.fov;applyCamera();container.dataset.camera=view;mageRoots.opponent.traverse(o=>{if(o instanceof THREE.Mesh){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m.transparent=view==="abstract";m.opacity=view==="abstract"?.2:1;}}});}
    function orbit(deltaYaw:number,deltaPitch:number){cameraYaw+=deltaYaw;cameraPitch=THREE.MathUtils.clamp(cameraPitch+deltaPitch,.12,1.38);applyCamera();}
    function zoom(delta:number){cameraDistance=THREE.MathUtils.clamp(cameraDistance+delta,4.8,11.5);applyCamera();}
    function resetCamera(){setCamera(currentView);}
    function pointerDown(e:PointerEvent){activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});renderer.domElement.setPointerCapture(e.pointerId);if(activePointers.size===1){dragPointer=e.pointerId;lastX=e.clientX;lastY=e.clientY}else if(activePointers.size===2){const ps=[...activePointers.values()];pinchDistance=Math.hypot(ps[0]!.x-ps[1]!.x,ps[0]!.y-ps[1]!.y);}}
    function pointerMove(e:PointerEvent){if(!activePointers.has(e.pointerId))return;activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(activePointers.size===2){const ps=[...activePointers.values()],next=Math.hypot(ps[0]!.x-ps[1]!.x,ps[0]!.y-ps[1]!.y);if(pinchDistance)zoom((pinchDistance-next)*.018);pinchDistance=next;return;}if(dragPointer===e.pointerId){const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;orbit(-dx*.008,dy*.006);}}
    function pointerUp(e:PointerEvent){activePointers.delete(e.pointerId);if(dragPointer===e.pointerId)dragPointer=undefined;if(activePointers.size<2)pinchDistance=0;}
    renderer.domElement.style.touchAction="none";renderer.domElement.addEventListener("pointerdown",pointerDown);renderer.domElement.addEventListener("pointermove",pointerMove);renderer.domElement.addEventListener("pointerup",pointerUp);renderer.domElement.addEventListener("pointercancel",pointerUp);renderer.domElement.addEventListener("wheel",e=>{e.preventDefault();zoom(e.deltaY*.006)},{passive:false});
    function pulseOpponentCast(){pulseUntil=performance.now()+420;}
    function presentSpell(side:"player"|"opponent",rune:ArenaRune){
        const from=new THREE.Vector3(POSITIONS[side].x,1.35,POSITIONS[side].z);
        const other=side==="player"?"opponent":"player"; const to=new THREE.Vector3(POSITIONS[other].x,1.25,POSITIONS[other].z);
        const color=side==="player"?0xad63ff:0xff7a3d;
        const mesh=new THREE.Mesh(new THREE.SphereGeometry(rune==="triangle"?.13:.09,10,10),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95}));
        const halo=new THREE.PointLight(color,2.2,3);mesh.add(halo);mesh.position.copy(from);scene.add(mesh);bolts.push({mesh,from,to,start:performance.now(),ms:rune==="line"?360:560});
        container.dataset.lastSpell=side+":"+rune;
    }
    function presentHit(side:"player"|"opponent",amount:number){hitFlash={side,until:performance.now()+300};container.dataset.lastHit=side+":"+amount;}

    const clock=new THREE.Clock();let frame=0;
    function resize(){const r=container.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=Math.max(.1,r.width/Math.max(1,r.height));camera.updateProjectionMatrix();}
    const ro=new ResizeObserver(resize);ro.observe(container);resize();setCamera("behind");
    function render(){frame=requestAnimationFrame(render);const dt=Math.min(clock.getDelta(),.05);for(const m of mixers)m.update(dt);const now=performance.now();
        for(let i=bolts.length-1;i>=0;i--){const b=bolts[i]!;const t=Math.min(1,(now-b.start)/b.ms);b.mesh.position.lerpVectors(b.from,b.to,t);b.mesh.scale.setScalar(1+Math.sin(t*Math.PI)*1.4);if(t>=1){scene.remove(b.mesh);bolts.splice(i,1);}}
        if(hitFlash){const root=mageRoots[hitFlash.side];root.scale.setScalar(now<hitFlash.until?1+Math.sin(now*.06)*.08:1);if(now>=hitFlash.until)hitFlash=undefined;}
        const pulse=now<pulseUntil?1-(pulseUntil-now)/420:0;runeGroup.scale.setScalar(runeVisible?1+Math.sin(pulse*Math.PI)*.18:1);glow.intensity=runeVisible?1.2+Math.sin(now*.01)*.35:0;renderer.render(scene,camera);}render();

    return {setCamera,orbit,zoom,resetCamera,showOpponentRune,pulseOpponentCast,presentSpell,presentHit,dispose(){cancelAnimationFrame(frame);ro.disconnect();renderer.dispose();container.removeChild(renderer.domElement);}};
}
