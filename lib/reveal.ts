/** Full flap → letter → text sequence. A completed/aborted run cannot fire twice. */
export const REVEAL_DURATION_MS = 1400;
export function createRevealController(onComplete:()=>void) {
 let timer:ReturnType<typeof setTimeout>|undefined;
 let running=false,disposed=false;
 const finish=()=>{if(!running||disposed)return;if(timer!==undefined)clearTimeout(timer);timer=undefined;running=false;onComplete();};
 return {
  start(immediate=false){if(disposed||running)return false;running=true;if(immediate)finish();else timer=setTimeout(finish,REVEAL_DURATION_MS);return true;},
  skip(){if(disposed)return;running=true;finish();},
  dispose(){disposed=true;running=false;if(timer!==undefined)clearTimeout(timer);timer=undefined;},
  isRunning:()=>running,
 };
}
