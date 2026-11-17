const { app, BrowserWindow, WebContentsView, ipcMain, shell, session, Menu, dialog, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const HOME = 'https://www.tiktok.com/foryou';
const HEIGHT = 60;
const defaults = { focus:false, mini:false, alwaysOnTop:false, autoNext:false, volume:80, speed:1 };
let win, bar, page, settings, focusKey, previousBounds, monitor;
function settingsPath(){ return path.join(app.getPath('userData'),'settings.json'); }
function loadSettings(){ try {return {...defaults,...JSON.parse(fs.readFileSync(settingsPath(),'utf8'))};}catch{return {...defaults};} }
function notify(message){ if(bar && !bar.webContents.isDestroyed()) bar.webContents.send('state',{...settings,message:message||''}); }
function save(message){ fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(settingsPath(),JSON.stringify(settings,null,2));notify(message); }
function isTikTok(url){try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='tiktok.com'||u.hostname.endsWith('.tiktok.com'));}catch{return false;}}
function external(url){try{const u=new URL(url);if(u.protocol==='https:')shell.openExternal(url);}catch{}}
function layout(){if(!win||!bar||!page)return;const [w,h]=win.getContentSize();bar.setBounds({x:0,y:0,width:w,height:HEIGHT});page.setBounds({x:0,y:HEIGHT,width:w,height:Math.max(0,h-HEIGHT)});}
async function js(code){try{if(page&&!page.webContents.isDestroyed())return await page.webContents.executeJavaScript(code,true);}catch{}return null;}
async function applyFocus(){if(!page||page.webContents.isDestroyed())return;if(focusKey){try{await page.webContents.removeInsertedCSS(focusKey);}catch{}focusKey=null;}if(settings.focus){try{focusKey=await page.webContents.insertCSS('aside, [data-e2e="nav-container"], [data-e2e="recommend-list-item-container"] ~ aside {display:none!important}');}catch{}}}
async function player(action,value){const script=`(()=>{const v=[...document.querySelectorAll('video')].find(x=>x.getBoundingClientRect().width>80)||document.querySelector('video');if(!v)return false;switch(${JSON.stringify(action)}){case 'pause':v.paused?v.play().catch(()=>{}):v.pause();break;case 'mute':v.muted=!v.muted;break;case 'volume':v.volume=${JSON.stringify(value)}/100;v.muted=false;break;case 'speed':v.playbackRate=${JSON.stringify(value)};break;}return true})()`;return js(script);}
function navigate(direction){const key=direction==='next'?'ArrowDown':'ArrowUp';const wc=page.webContents;wc.focus();wc.sendInputEvent({type:'keyDown',keyCode:key});wc.sendInputEvent({type:'keyUp',keyCode:key});}
function mini(enable){if(enable&&!settings.mini){previousBounds=win.getBounds();win.setSize(460,760);win.setAlwaysOnTop(true);}else if(!enable&&settings.mini){if(previousBounds)win.setBounds(previousBounds);win.setAlwaysOnTop(settings.alwaysOnTop);}settings.mini=enable;save();}
async function download(){
  // Only attempt a direct, already-playable HTTPS media URL; no private API, DRM or signature bypass.
  const data=await js(`(()=>{const v=[...document.querySelectorAll('video')].find(x=>x.getBoundingClientRect().width>80)||document.querySelector('video');return {src:v?.currentSrc||v?.src||'',page:location.href}})()`);
  if(!data){notify('Видео не найдено');return;}
  let url;try{url=new URL(data.src);}catch{}
  if(!url||url.protocol!=='https:'||!/^video\//.test('video/')){clipboard.writeText(data.page||page.webContents.getURL());notify('Прямая загрузка недоступна — ссылка на видео скопирована');return;}
  const result=await dialog.showSaveDialog(win,{title:'Сохранить доступное видео',defaultPath:'tiktok-video.mp4',filters:[{name:'Видео MP4',extensions:['mp4']},{name:'Все файлы',extensions:['*']}]});
  if(result.canceled||!result.filePath)return;
  const ses=page.webContents.session;
  const listener=(event,item,contents)=>{if(contents!==page.webContents||item.getURL()!==url.href)return;ses.removeListener('will-download',listener);item.setSavePath(result.filePath);item.once('done',(_e,state)=>notify(state==='completed'?'Видео сохранено':'Загрузка не завершена: '+state));};
  ses.on('will-download',listener);
  try{page.webContents.downloadURL(url.href);notify('Начинаем загрузку…');}catch{ses.removeListener('will-download',listener);clipboard.writeText(data.page||'');notify('Загрузка недоступна — ссылка скопирована');}
}
async function command(cmd,value){if(!page||page.webContents.isDestroyed())return;const wc=page.webContents;
 if(cmd==='home')wc.loadURL(HOME);
 else if(cmd==='back'&&wc.canGoBack())wc.goBack();
 else if(cmd==='reload')wc.reload();
 else if(cmd==='external')external(wc.getURL());
 else if(cmd==='mini')mini(!settings.mini);
 else if(cmd==='top'){settings.alwaysOnTop=!settings.alwaysOnTop;win.setAlwaysOnTop(settings.mini||settings.alwaysOnTop);save();}
 else if(cmd==='focus'){settings.focus=!settings.focus;save();applyFocus();}
 else if(cmd==='autoNext'){settings.autoNext=!settings.autoNext;save();}
 else if(cmd==='fullscreen')win.setFullScreen(!win.isFullScreen());
 else if(cmd==='next'||cmd==='prev')navigate(cmd);
 else if(cmd==='pause'||cmd==='mute')await player(cmd);
 else if(cmd==='volume'&&Number.isFinite(value)){settings.volume=Math.min(100,Math.max(0,value));save();await player('volume',settings.volume);}
 else if(cmd==='speed'&&[0.5,0.75,1,1.25,1.5,2].includes(value)){settings.speed=value;save();await player('speed',value);}
 else if(cmd==='download')await download();
 else if(cmd==='copy'){clipboard.writeText(wc.getURL());notify('Ссылка скопирована');}
}
function createWindow(){
 win=new BrowserWindow({width:1250,height:850,minWidth:400,minHeight:440,backgroundColor:'#09090b',title:'TikTok Enhanced 0.3',autoHideMenuBar:true});Menu.setApplicationMenu(null);
 bar=new WebContentsView({webPreferences:{preload:path.join(__dirname,'toolbar-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 page=new WebContentsView({webPreferences:{partition:'persist:tiktok',contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.contentView.addChildView(bar);win.contentView.addChildView(page);layout();win.on('resize',layout);
 bar.webContents.loadFile(path.join(__dirname,'toolbar.html'));bar.webContents.once('did-finish-load',()=>notify());
 page.webContents.loadURL(HOME);
 page.webContents.setWindowOpenHandler(({url})=>{if(isTikTok(url))page.webContents.loadURL(url);else external(url);return {action:'deny'};});
 page.webContents.on('will-navigate',(e,url)=>{if(!isTikTok(url)){e.preventDefault();external(url);}});
 page.webContents.on('did-finish-load',()=>{applyFocus();});
 // Check for an ended visible video; one transition per ended video.
 monitor=setInterval(async()=>{if(!settings.autoNext||!page||page.webContents.isDestroyed())return;const ended=await js(`(()=>{const v=[...document.querySelectorAll('video')].find(x=>x.getBoundingClientRect().width>80)||document.querySelector('video');if(!v||!v.ended||v.dataset.teAdvanced==='yes')return false;v.dataset.teAdvanced='yes';return true})()`);if(ended)navigate('next');},900);
 win.on('closed',()=>{clearInterval(monitor);win=null;bar=null;page=null;});
 if(settings.mini){settings.mini=false;mini(true);}else win.setAlwaysOnTop(settings.alwaysOnTop);
}
app.whenReady().then(()=>{settings=loadSettings();const ses=session.fromPartition('persist:tiktok');ses.setPermissionRequestHandler((_wc,_p,callback)=>callback(false));
 ipcMain.on('command',(event,cmd,value)=>{if(event.sender!==bar?.webContents||typeof cmd!=='string')return;if(['home','back','reload','external','mini','top','focus','autoNext','fullscreen','next','prev','pause','mute','volume','speed','download','copy'].includes(cmd))command(cmd,value);});
 ipcMain.handle('get-state',event=>event.sender===bar?.webContents?settings:null);
 createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
