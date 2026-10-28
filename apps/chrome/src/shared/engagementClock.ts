/** Foreground interaction time, with an idle lease. Never counts model latency. */
export function createEngagementClock(start=0,idleMs=60000){
  let enabled=false,visible=false,last=start,activeUntil=start,pending=0;
  const settle=(now:number)=>{if(enabled&&visible)pending+=Math.max(0,Math.min(now,activeUntil)-last);last=now;};
  return {
    enabled(value:boolean,now:number){settle(now);enabled=value;if(value)activeUntil=now+idleMs;},
    visible(value:boolean,now:number){settle(now);visible=value;},
    interact(now:number){settle(now);activeUntil=now+idleMs;},
    take(now:number){settle(now);const ms=Math.floor(pending);pending-=ms;return ms;},
  };
}
