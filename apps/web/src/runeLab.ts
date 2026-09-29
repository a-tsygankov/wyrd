type Point={x:number;y:number;t:number}; type Rune="line"|"arc"|"circle"|"triangle"|"spiral"|"unknown";
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>("rune-canvas"), cast=$("cast"), ctx=canvas.getContext("2d")!;
const recognized=$("recognized"), quality=$("quality"), intent=$("enemy-intent"), result=$("result"), timer=$("timer");
let points:Point[]=[]; let drawing=false; let mode:"fencing"|"parry"="fencing"; let hpYou=100,hpEnemy=100; let roundOpen=true; let parryDeadline=0; let enemyRune:Rune="unknown"; let fencingTimer=60; let tick=0;
const names:Record<Rune,string>={line:"PIERCE",arc:"REDIRECT",circle:"WARD",triangle:"POWER",spiral:"ABSORB",unknown:"—"};
function resize(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;canvas.width=r.width*d;canvas.height=r.height*d;ctx.setTransform(d,0,0,d,0,0);redraw()}
new ResizeObserver(resize).observe(canvas);
function redraw(){const r=canvas.getBoundingClientRect();ctx.clearRect(0,0,r.width,r.height);if(points.length<2)return;ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="#a978ff";ctx.shadowColor="#8b5cff";ctx.shadowBlur=14;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(points[0]!.x,points[0]!.y);for(const p of points.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke();ctx.shadowBlur=0}
function dist(a:Point,b:Point){return Math.hypot(a.x-b.x,a.y-b.y)}
function pathLength(ps:Point[]){let n=0;for(let i=1;i<ps.length;i++)n+=dist(ps[i-1]!,ps[i]!);return n}
function classify(ps:Point[]):{rune:Rune;score:number;detail:string}{
 if(ps.length<5)return{rune:"unknown",score:0,detail:"too short"};
 const xs=ps.map(p=>p.x),ys=ps.map(p=>p.y),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys),diag=Math.hypot(w,h)||1;
 const len=pathLength(ps),closure=dist(ps[0]!,ps.at(-1)!)/diag,straight=dist(ps[0]!,ps.at(-1)!)/(len||1);
 let turns=0,totalTurn=0,last:number|undefined;
 for(let i=1;i<ps.length;i++){const a=Math.atan2(ps[i]!.y-ps[i-1]!.y,ps[i]!.x-ps[i-1]!.x);if(last!==undefined){let d=a-last;while(d>Math.PI)d-=Math.PI*2;while(d< -Math.PI)d+=Math.PI*2;totalTurn+=d;if(Math.abs(d)>.42)turns++}last=a}
 const absTurn=Math.abs(totalTurn);
 if(straight>.91)return{rune:"line",score:Math.min(1,straight),detail:`straight ${Math.round(straight*100)}%`};
 if(closure<.28&&absTurn>Math.PI*2.35)return{rune:"spiral",score:Math.min(1,.65+absTurn/(Math.PI*10)),detail:`turn ${absTurn.toFixed(1)} rad`};
 if(closure<.24){if(turns<=8&&absTurn>4.2&&absTurn<8.1)return{rune:"circle",score:Math.max(.62,1-closure),detail:`closure ${Math.round((1-closure)*100)}%`};return{rune:"triangle",score:Math.max(.58,Math.min(1,.72+(8-Math.min(8,turns))*.035)),detail:`corners ~${Math.max(3,turns)}`}}
 if(absTurn>1.2)return{rune:"arc",score:Math.min(1,.6+absTurn/8),detail:`curve ${absTurn.toFixed(1)} rad`};
 return{rune:"line",score:.58,detail:"open stroke"};
}
function point(e:PointerEvent):Point{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top,t:performance.now()}}
cast.addEventListener("pointerdown",e=>{if(!roundOpen)return;drawing=true;points=[point(e)];canvas.setPointerCapture(e.pointerId);redraw()});
cast.addEventListener("pointermove",e=>{if(!drawing)return;const p=point(e);if(dist(points.at(-1)!,p)>2)points.push(p);redraw();if(points.length>8){const c=classify(points);recognized.textContent=names[c.rune];quality.textContent=`${Math.round(c.score*100)}% · ${c.detail}`}});
cast.addEventListener("pointerup",()=>{if(!drawing)return;drawing=false;const c=classify(points);recognized.textContent=names[c.rune];quality.textContent=`${Math.round(c.score*100)}% stability`;resolvePlayer(c.rune,c.score)});
const counters:Record<Rune,Rune[]>={line:["circle","arc"],arc:["triangle","line"],circle:["spiral","triangle"],triangle:["circle","arc"],spiral:["line","triangle"],unknown:[]};
function flash(text:string,good:boolean){result.textContent=text;result.style.color=good?"#72e5ff":"#ff776f";result.classList.remove("show");void result.offsetWidth;result.classList.add("show")}
function damage(side:"you"|"enemy",n:number){if(side==="you")hpYou=Math.max(0,hpYou-n);else hpEnemy=Math.max(0,hpEnemy-n);$("hp-you").style.width=hpYou+"%";$("hp-enemy").style.width=hpEnemy+"%"}
function resolvePlayer(r:Rune,score:number){if(r==="unknown")return flash("FIZZLE",false);if(mode==="fencing"){const good=counters[enemyRune]?.includes(r);if(good){damage("enemy",Math.round(8+score*8));flash(r==="arc"?"REDIRECT":"PARRY",true)}else{damage("you",Math.round(7+(1-score)*7));flash("HIT",false)}points=[];setTimeout(redraw,260);scheduleFencing()}else resolveParry(r,score)}
function chooseEnemy():Rune{return(["line","arc","circle","triangle","spiral"] as Rune[])[Math.floor(Math.random()*5)]!}
function scheduleFencing(){roundOpen=false;intent.classList.remove("show");setTimeout(()=>{enemyRune=chooseEnemy();intent.textContent="SENSING…";intent.classList.add("show");setTimeout(()=>intent.textContent=enemyRune==="triangle"?"ANGULAR · POWER?":enemyRune==="circle"?"CLOSED · WARD?":enemyRune==="spiral"?"ROTATION · DRAIN?":enemyRune==="arc"?"CURVED · BEND?":"DIRECT · FORCE?",420);setTimeout(()=>intent.textContent=names[enemyRune],850);roundOpen=true;$("cast-label").textContent="COUNTER NOW";},500)}
function startParry(){roundOpen=true;points=[];redraw();enemyRune=chooseEnemy();parryDeadline=performance.now()+4000;intent.textContent="ENEMY CAST HIDDEN";intent.classList.add("show");$("cast-label").textContent="COMMIT BEFORE REVEAL";timer.textContent="4.0"}
function resolveParry(r:Rune,score:number){roundOpen=false;intent.textContent="REVEAL · "+names[enemyRune];const playerWins=counters[enemyRune]?.includes(r),enemyWins=counters[r]?.includes(enemyRune);setTimeout(()=>{if(playerWins&&!enemyWins){damage("enemy",Math.round(12+score*10));flash("PARRY",true)}else if(enemyWins&&!playerWins){damage("you",18);flash("COUNTERED",false)}else flash("CLASH",true);setTimeout(startParry,1200)},550)}
function setMode(m:"fencing"|"parry"){mode=m;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",(x as HTMLElement).dataset.mode===m));hpYou=hpEnemy=100;damage("you",0);damage("enemy",0);points=[];redraw();if(m==="fencing"){$("mode-title").textContent="Real-time spell fencing";$("mode-help").textContent="Read the telegraph. Draw a counter before impact.";timer.textContent="60";fencingTimer=60;scheduleFencing()}else{$("mode-title").textContent="Simultaneous rune parry";$("mode-help").textContent="Commit within 4 seconds, then both runes resolve.";startParry()}}
document.querySelectorAll<HTMLButtonElement>(".tab").forEach(b=>b.onclick=()=>setMode(b.dataset.mode as "fencing"|"parry"));$("reset").onclick=()=>setMode(mode);
setInterval(()=>{if(mode==="fencing"){if(++tick%10===0&&fencingTimer>0)timer.textContent=String(--fencingTimer)}else if(roundOpen){const left=Math.max(0,parryDeadline-performance.now());timer.textContent=(left/1000).toFixed(1);if(left<=0){roundOpen=false;damage("you",12);flash("TOO SLOW",false);setTimeout(startParry,900)}}},100);
setMode("fencing");
