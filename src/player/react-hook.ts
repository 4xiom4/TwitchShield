export interface TwitchPlayerInstance {
  player: any;
  state: any;
}

export function findReactRootNode(): any {
  const rootNode = document.querySelector('#root') as any;
  if (!rootNode) return null;

  if (rootNode._reactRootContainer?._internalRoot?.current) {
    return rootNode._reactRootContainer._internalRoot.current;
  }

  const containerKey = Object.keys(rootNode).find(k => k.startsWith('__reactContainer'));
  if (containerKey) {
    return rootNode[containerKey];
  }

  return null;
}

export function findReactNode(root: any, predicate: (node: any) => boolean): any {
  if (!root) return null;
  if (root.stateNode && predicate(root.stateNode)) {
    return root.stateNode;
  }
  let child = root.child;
  while (child) {
    const found = findReactNode(child, predicate);
    if (found) return found;
    child = child.sibling;
  }
  return null;
}

export function getTwitchPlayer(): TwitchPlayerInstance | null {
  const reactRoot = findReactRootNode();
  if (!reactRoot) return null;

  let player = findReactNode(
    reactRoot,
    node => node.setPlayerActive && node.props?.mediaPlayerInstance
  );
  player = player?.props?.mediaPlayerInstance ?? null;
  if (player?.playerInstance) {
    player = player.playerInstance;
  }

  const playerState = findReactNode(
    reactRoot,
    node => node.setSrc && node.setInitialPlaybackSettings
  );

  if (player && playerState) {
    return { player, state: playerState };
  }
  return null;
}

export function reloadPlayer(): void {
  const instance = getTwitchPlayer();
  if (!instance) {
    console.warn('[TwitchShield] Could not find Twitch player instance to reload.');
    return;
  }

  const { player, state } = instance;
  try {
    console.log('[TwitchShield] Performing soft reload of Twitch player...');
    state.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
    player.play();
  } catch (err) {
    console.error('[TwitchShield] Player reload failed:', err);
  }
}

export function pauseResumePlayer(): void {
  const instance = getTwitchPlayer();
  if (instance?.player) {
    instance.player.pause();
    instance.player.play();
  } else {
    const video = document.querySelector('video');
    if (video) {
      video.pause();
      video.play().catch(() => {});
    }
  }
}
