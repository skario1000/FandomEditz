import { useEffect, useState } from 'react';
import { useEditor } from './store';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { ExportDialog } from './components/ExportDialog';
import { DropOverlay, HelpModal, Toasts } from './components/Overlays';
import { AiModal } from './components/AiModal';
import { StartScreen } from './components/StartScreen';
import { MobileEditor } from './components/mobile/MobileEditor';
import { MobileStartScreen } from './components/mobile/MobileStartScreen';
import { useIsPhone } from './lib/useIsPhone';
import { DEMOS, loadDemoImages } from './lib/demo';
import { audio, DEMO_BEAT_ID, synthDemoBeat } from './lib/audio';
import { importFiles } from './lib/media';
import { closeProject, createProjectFromFiles, initProjects, setDemoBeat } from './lib/projects';
import { loadEditFonts } from './lib/textEngine';
import { totalDuration, layoutClips, clipAtTime } from './lib/velocity';
import { animatedValue } from './lib/keyframes';
import { CLIP_PROPS } from './types';
import { clamp } from './lib/utils';

let booted = false;
/** Shared assets (demo clips + demo beat + fonts) and the project library. Projects open from the start screen. */
async function boot() {
  if (booted) return;
  booted = true;
  void loadEditFonts().then(() => useEditor.getState().bumpThumbs());
  await loadDemoImages();
  const st = useEditor.getState();
  for (const d of DEMOS) {
    st.addMedia({ id: 'demo-' + d.id, name: d.name, kind: 'demo', url: '', demoId: d.id, duration: d.duration, width: d.width, height: d.height, fps: d.fps, status: 'ready' });
  }
  try {
    const { buffer, beats, bpm } = await synthDemoBeat();
    audio.register(DEMO_BEAT_ID, buffer);
    setDemoBeat(beats, bpm);
    st.addMedia({ id: DEMO_BEAT_ID, name: 'Demo Phonk Beat · 130 BPM', kind: 'audio', url: '', duration: buffer.duration, width: 0, height: 0, fps: 0, status: 'ready' });
  } catch {
    /* no OfflineAudioContext — templates fall back to a 130 BPM grid */
  }
  try {
    await initProjects();
  } catch (e) {
    console.warn('Editverse: project library init failed', e);
  }
  useEditor.getState().ui({ booted: true });
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      const st = useEditor.getState();
      if (st.screen !== 'editor' || st.opening) return;
      if (st.exportOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (st.viewer === 'source' && (k === 'i' || k === 'o' || e.code === 'Space')) return;
      const fps = st.project.fps;
      if (e.code === 'Space') {
        e.preventDefault();
        st.togglePlay();
      } else if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        st.redo();
      } else if (mod && k === 'd') {
        e.preventDefault();
        st.duplicateSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        st.removeSelected();
      } else if (!mod && k === 's') st.splitAtPlayhead();
      else if (!mod && k === 'b') {
        st.addBeat(st.playing ? st.time : st.time);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (t && t.tagName === 'INPUT') return;
        e.preventDefault();
        st.pause();
        const d = (e.shiftKey ? 1 : 1 / fps) * (e.key === 'ArrowLeft' ? -1 : 1);
        st.setTime(Math.round((st.time + d) * fps) / fps);
      } else if (e.key === 'Home') st.setTime(0);
      else if (e.key === 'End') st.setTime(totalDuration(st.project.clips));
      else if (!mod && (e.key === '[' || e.key === ']')) {
        const target = st.targetClip();
        if (!target) return;
        const step = e.shiftKey ? 15 : 1;
        const cur = animatedValue(target.clip.keyframes, CLIP_PROPS[3], target.u, target.clip.rotation);
        st.setTransform({ rotation: cur + (e.key === ']' ? step : -step) });
        st.toast(`Rotate ${e.key === ']' ? '+' : '−'}${step}°`, 'info');
      } else if (!mod && (e.key === ',' || e.key === '.')) {
        const target = st.targetClip();
        if (!target) return;
        const step = e.shiftKey ? 0.01 : 0.05;
        const cur = animatedValue(target.clip.keyframes, CLIP_PROPS[0], target.u, target.clip.scale);
        st.setTransform({ scale: cur * (1 + (e.key === '.' ? step : -step)) });
        st.toast(`Zoom ${e.key === '.' ? '+' : '−'}${Math.round(step * 100)}%`, 'info');
      } else if (!mod && e.key === '0') st.resetTransform();
      else if (!mod && (k === 'r' || k === 't')) {
        const id = st.selection?.kind === 'clip' ? st.selection.id : clipAtTime(layoutClips(st.project.clips), st.time)?.clip.id;
        const c = st.project.clips.find((x) => x.id === id);
        if (!c) return;
        if (k === 'r') st.updateClip(c.id, { reverse: !c.reverse });
        else st.updateClip(c.id, c.twixtor ? { twixtor: false } : { twixtor: true, speed: c.speed >= 0.99 ? 0.35 : c.speed });
        st.toast(k === 'r' ? `Reverse ${!c.reverse ? 'on' : 'off'}` : `Twixtor ${!c.twixtor ? 'on' : 'off'}`, 'info');
      } else if (e.key === '=' || e.key === '+') st.ui({ pxPerSec: clamp(st.pxPerSec * 1.3, 12, 600) });
      else if (e.key === '-' || e.key === '_') st.ui({ pxPerSec: clamp(st.pxPerSec / 1.3, 12, 600) });
      else if (e.key === 'Escape') st.select(null);
    };
    window.addEventListener('keydown', onKey);
    const noFocus = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest?.('button');
      if (b) e.preventDefault();
    };
    document.addEventListener('mousedown', noFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', noFocus);
    };
  }, []);
}

function useFileDrop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth++;
      setShow(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setShow(false);
    };
    const over = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setShow(false);
      const files = Array.from(e.dataTransfer!.files);
      const st = useEditor.getState();
      if (!files.length || !st.booted || st.opening) return;
      if (st.screen === 'home') void createProjectFromFiles(files);
      else void importFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return show;
}

export default function App() {
  useEffect(() => {
    void boot();
  }, []);
  useShortcuts();
  const dropping = useFileDrop();
  const screen = useEditor((s) => s.screen);
  const hasProject = useEditor((s) => !!s.currentProjectId);
  const { isPhone } = useIsPhone();

  // browser back button returns to the project list
  useEffect(() => {
    if (screen === 'editor') history.pushState({ ev: 'editor' }, '');
    const onPop = () => {
      if (useEditor.getState().screen === 'editor') void closeProject();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [screen]);

  // PHONE VERSION: activates only on phone (or when forced via toggle / query param)
  if (isPhone) {
    if (screen === 'home' || !hasProject) {
      return (
        <>
          <MobileStartScreen />
          <HelpModal />
          <Toasts />
          <DropOverlay show={dropping} />
        </>
      );
    }
    return (
      <>
        <MobileEditor />
        <DropOverlay show={dropping} />
      </>
    );
  }

  // DESKTOP VERSION
  if (screen === 'home' || !hasProject) {
    return (
      <>
        <StartScreen />
        <AiModal />
        <HelpModal />
        <Toasts />
        <DropOverlay show={dropping} />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-[#07070b] text-zinc-200">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="flex min-w-0 flex-1 flex-col">
          <PreviewPanel />
        </main>
        <Inspector />
      </div>
      <div className="h-[268px] shrink-0 border-t border-white/[0.08]">
        <Timeline />
      </div>
      <AiModal />
      <ExportDialog />
      <HelpModal />
      <Toasts />
      <DropOverlay show={dropping} />
    </div>
  );
}
