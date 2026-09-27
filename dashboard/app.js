const canvas = document.querySelector("#globe");
const ctx = canvas.getContext("2d");
const search = document.querySelector("#search");

const sampleUsers = [
  {userId:"u-nyc",name:"Alex Johnson",email:"alex.johnson@example.com",country:"United States",state:"New York",city:"New York",latitude:40.7128,longitude:-74.006,status:"online",lastSeenAt:new Date().toISOString(),device:{platform:"web",osVersion:"Windows 11"}},
  {userId:"u-raipur",name:"Demo Raipur",country:"India",state:"Chhattisgarh",city:"Raipur",latitude:21.2514,longitude:81.6296,status:"online",lastSeenAt:new Date(Date.now()-45000).toISOString(),device:{platform:"android",appVersion:"2.27"}},
  {userId:"u-london",name:"Demo London",country:"United Kingdom",state:"England",city:"London",latitude:51.5072,longitude:-0.1276,status:"recent",lastSeenAt:new Date(Date.now()-8*60000).toISOString(),device:{platform:"web"}},
  {userId:"u-sf",name:"Demo San Francisco",country:"United States",state:"California",city:"San Francisco",latitude:37.7749,longitude:-122.4194,status:"offline",lastSeenAt:new Date(Date.now()-2*3600000).toISOString(),device:{platform:"ios"}},
  {userId:"u-tokyo",name:"Demo Tokyo",country:"Japan",state:"Tokyo",city:"Tokyo",latitude:35.6762,longitude:139.6503,status:"online",lastSeenAt:new Date(Date.now()-70000).toISOString(),device:{platform:"android"}},
  {userId:"u-sydney",name:"Demo Sydney",country:"Australia",state:"NSW",city:"Sydney",latitude:-33.8688,longitude:151.2093,status:"inactive",lastSeenAt:new Date(Date.now()-2*86400000).toISOString(),device:{platform:"android"}},
  {userId:"u-jhb",name:"Demo Johannesburg",country:"South Africa",state:"Gauteng",city:"Johannesburg",latitude:-26.2041,longitude:28.0473,status:"recent",lastSeenAt:new Date(Date.now()-5*60000).toISOString(),device:{platform:"web"}},
  {userId:"u-sp",name:"Demo São Paulo",country:"Brazil",state:"São Paulo",city:"São Paulo",latitude:-23.5505,longitude:-46.6333,status:"online",lastSeenAt:new Date(Date.now()-30000).toISOString(),device:{platform:"android"}}
];

let users=[...sampleUsers],filtered=[...sampleUsers],activeStatus="",rotation=-20,zoom=1,paused=false,updates=0;
const colors={online:"#54d878",recent:"#ffc64d",offline:"#ff6666",inactive:"#8a96a6"};
const count=(status)=>users.filter((u)=>u.status===status).length;
const setText=(id,value)=>document.querySelector("#"+id).textContent=value;

function updateStats(){
  setText("total",users.length);setText("online",count("online"));setText("offline",count("offline"));setText("recent",count("recent"));setText("updates",updates);
  setText("allCount",users.length);setText("onlineSide",count("online"));setText("recentSide",count("recent"));setText("offlineSide",count("offline"));setText("liveBadge",count("online"));setText("showingCount",filtered.length);
}
function unique(field){return [...new Set(users.map((u)=>u[field]).filter(Boolean))].sort()}
function fillSelect(id,values,label){
  const el=document.querySelector("#"+id),current=el.value;
  el.innerHTML=`<option value="">All ${label}</option>`;
  values.forEach((v)=>{const o=document.createElement("option");o.value=o.textContent=v;el.appendChild(o)});
  if(values.includes(current))el.value=current;
}
function rebuildGeoFilters(){fillSelect("country",unique("country"),"Countries");fillSelect("state",unique("state"),"States");fillSelect("city",unique("city"),"Cities")}
function applyFilters(){
  const q=search.value.toLowerCase().trim();
  const country=document.querySelector("#country").value,state=document.querySelector("#state").value,city=document.querySelector("#city").value;
  filtered=users.filter((u)=>
    (!activeStatus||u.status===activeStatus) &&
    (!q||[u.userId,u.name,u.email].some((v)=>String(v||"").toLowerCase().includes(q))) &&
    (!country||u.country===country) && (!state||u.state===state) && (!city||u.city===city)
  );
  updateStats();
}
document.querySelectorAll(".status-filter").forEach((btn)=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".status-filter").forEach((x)=>x.classList.remove("active"));
  btn.classList.add("active");activeStatus=btn.dataset.status;applyFilters();
}));
[search,document.querySelector("#country"),document.querySelector("#state"),document.querySelector("#city")].forEach((el)=>el.addEventListener("input",applyFilters));
document.querySelector("#reset").onclick=()=>{
  search.value="";activeStatus="";
  document.querySelectorAll("select").forEach((s)=>{if(s.id!=="project")s.value=""});
  document.querySelectorAll(".status-filter").forEach((x,i)=>x.classList.toggle("active",i===0));
  applyFilters();
};
document.querySelector("#pause").onclick=()=>paused=!paused;
document.querySelector("#zoomIn").onclick=()=>zoom=Math.min(1.5,zoom+.1);
document.querySelector("#zoomOut").onclick=()=>zoom=Math.max(.7,zoom-.1);
document.querySelector("#center").onclick=()=>rotation=-20;

function resize(){
  const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
addEventListener("resize",resize);resize();

function project(lat,lng,cx,cy,r){
  const phi=lat*Math.PI/180,lambda=(lng-rotation)*Math.PI/180;
  const x=Math.cos(phi)*Math.sin(lambda),y=Math.sin(phi),z=Math.cos(phi)*Math.cos(lambda);
  return {x:cx+x*r,y:cy-y*r,z};
}
function starfield(w,h){
  ctx.fillStyle="rgba(255,255,255,.7)";
  for(let i=0;i<80;i++){
    const x=(i*97.13)%w,y=(i*53.77)%h,a=(i%5+1)/6;
    ctx.globalAlpha=a;ctx.fillRect(x,y,1,1);
  }
  ctx.globalAlpha=1;
}
function draw(){
  const w=canvas.clientWidth,h=canvas.clientHeight;
  ctx.clearRect(0,0,w,h);starfield(w,h);
  const cx=w*.5,cy=h*.48,r=Math.min(w*.37,h*.43)*zoom;
  const grad=ctx.createRadialGradient(cx-r*.35,cy-r*.35,r*.1,cx,cy,r);
  grad.addColorStop(0,"#0a3653");grad.addColorStop(.65,"#061e31");grad.addColorStop(1,"#020812");
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill();
  ctx.strokeStyle="#2d9cff";ctx.lineWidth=1.4;ctx.shadowColor="#2d9cff";ctx.shadowBlur=18;ctx.stroke();ctx.shadowBlur=0;

  ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
  ctx.strokeStyle="rgba(68,150,196,.18)";ctx.lineWidth=1;

  for(let lat=-60;lat<=60;lat+=30){
    ctx.beginPath();let started=false;
    for(let lng=-180;lng<=180;lng+=3){
      const p=project(lat,lng,cx,cy,r);
      if(p.z>0){if(!started){ctx.moveTo(p.x,p.y);started=true}else ctx.lineTo(p.x,p.y)}
    }
    ctx.stroke();
  }
  for(let lng=-180;lng<180;lng+=30){
    ctx.beginPath();let started=false;
    for(let lat=-90;lat<=90;lat+=3){
      const p=project(lat,lng,cx,cy,r);
      if(p.z>0){if(!started){ctx.moveTo(p.x,p.y);started=true}else ctx.lineTo(p.x,p.y)}
    }
    ctx.stroke();
  }

  for(const u of filtered){
    const p=project(u.latitude,u.longitude,cx,cy,r);
    if(p.z<=0){u.__screen=null;continue}
    const size=4+4*p.z;
    ctx.beginPath();ctx.arc(p.x,p.y,size,0,Math.PI*2);
    ctx.fillStyle=colors[u.status]||colors.inactive;ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;
    u.__screen={x:p.x,y:p.y,z:p.z};
  }
  ctx.restore();
  if(!paused)rotation=(rotation+.025)%360;
  requestAnimationFrame(draw);
}
draw();

canvas.addEventListener("click",(e)=>{
  const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
  let best=null,dist=18;
  for(const u of filtered){
    if(!u.__screen)continue;
    const d=Math.hypot(u.__screen.x-x,u.__screen.y-y);
    if(d<dist){best=u;dist=d}
  }
  if(best)showDetail(best);
});

function showDetail(u){
  setText("detailName",u.name||u.userId||"Select a user");
  setText("detailEmail",u.email||u.userId||"Click a marker on the globe.");
  setText("detailStatus",u.status||"—");
  setText("detailLocation",[u.city,u.state,u.country].filter(Boolean).join(", ")||"—");
  setText("detailCoords",Number.isFinite(u.latitude)&&Number.isFinite(u.longitude)?`${u.latitude.toFixed(4)}, ${u.longitude.toFixed(4)}`:"—");
  setText("detailDevice",[u.device?.platform,u.device?.appVersion,u.device?.osVersion].filter(Boolean).join(" · ")||"—");
  setText("detailSeen",u.lastSeenAt?new Date(u.lastSeenAt).toLocaleString():"—");
  document.querySelector("#activity").innerHTML=u.lastSeenAt
    ? `<div><b>Location update</b><small>${new Date(u.lastSeenAt).toLocaleTimeString()}</small></div><div><b>Status: ${u.status}</b><small>Project-isolated live state</small></div>`
    : "";
}
document.querySelector("#detailClose").onclick=()=>showDetail({});

async function loadConfiguredApi(){
  const cfg=window.GEOLIVE_CONFIG;
  if(!cfg?.baseUrl||!cfg?.adminKey)return;
  try{
    const headers={authorization:`Bearer ${cfg.adminKey}`};
    const res=await fetch(`${cfg.baseUrl.replace(/\/$/,"")}/v1/users`,{headers});
    if(!res.ok)throw new Error("users request failed");
    const data=await res.json();
    users=data.users||[];updates++;rebuildGeoFilters();applyFilters();setText("lastUpdated","Last updated: just now");
  }catch(error){
    console.error("GeoLive dashboard API error",error);
  }
}

rebuildGeoFilters();applyFilters();showDetail(sampleUsers[0]);loadConfiguredApi();
