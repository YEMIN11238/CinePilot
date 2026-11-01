import type { DirectorProject } from "./directorTypes";

export function directorGenerationContext(project: DirectorProject): string {
  const model = (kind: "image" | "video") => {
    const value = project.models[kind];
    return value ? [value.providerId, value.modelId, value.resolution ?? null, value.size ?? null] : null;
  };
  return JSON.stringify({ image: model("image"), video: model("video"), ratio: project.ratio });
}

export function directorReviewContext(project: DirectorProject, shotId: string): string {
  const shot = project.shots.find(item => item.id === shotId);
  const version = shot?.versions.find(item => item.id === shot.currentVersionId);
  const scene = project.production?.scriptVersions.find(item => item.id === project.production?.currentScriptVersionId)?.scenes.find(item => item.id === version?.sceneId);
  return JSON.stringify({
    scene,
    sceneReference: project.production?.sceneReferences?.find(item => item.sceneId === version?.sceneId),
    characters: project.production?.characters.filter(character => version?.characterIds?.includes(character.id)).map(character => ({ id: character.id, revision: character.revision })),
    neighbours: project.shots.filter(item => shot && Math.abs(item.order - shot.order) === 1).map(item => {
      const neighbour = item.versions.find(entry => entry.id === item.currentVersionId);
      return { id: item.id, description: neighbour?.description, camera: neighbour?.camera, sceneId: neighbour?.sceneId, characterIds: neighbour?.characterIds, startState: neighbour?.startState, endState: neighbour?.endState, clip: neighbour?.clip?.path, keyframe: neighbour?.keyframe?.path };
    }),
    originalAudio: project.originalAudio ?? false,
    music: project.music ?? null,
    audio: (project.audioTracks ?? []).filter(track => !track.shotId || track.shotId === shotId),
  });
}
