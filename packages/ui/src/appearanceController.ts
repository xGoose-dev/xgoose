import {normalizeState,equalAppearance,appearanceParams,DEFAULT_APPEARANCE_STATE,type AppearanceState} from "./appearance";
export type AppearanceTrack = (event:string, params:Record<string,string|number|boolean>)=>void;
type Options={initial:AppearanceState;save:(value:AppearanceState)=>Promise<void>;apply:(value:AppearanceState)=>void;track:AppearanceTrack;entry:string;dark:()=>boolean;changed?:(state:AppearanceState,status:string)=>void};
/** Serial writes, coalesced sliders and rollback without touching non-appearance settings. */
export class AppearanceController {
  saved:AppearanceState; draft:AppearanceState; failed?:AppearanceState;
  private timer?:ReturnType<typeof setTimeout>; private task:Promise<void>=Promise.resolve();
  private flow=crypto.randomUUID(); private version=0; private resetPending=false;
  constructor(private options:Options) {this.saved=normalizeState(options.initial);this.draft=this.saved;this.emit("appearance_opened");}
  private emit(event:string,state=this.draft,extra:Record<string,string|number|boolean>={}) {this.options.track(event,{...appearanceParams(state,this.options.dark()),entry_point:this.options.entry,flow_id:this.flow,...extra});}
  private show(status:string) {this.options.apply(this.draft);this.options.changed?.(this.draft,status);}
  change(next:AppearanceState) {
    next=normalizeState(next);if(equalAppearance(next,this.draft))return;
    this.draft=next;this.version++;this.resetPending=false;this.show("Saving…");
    clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush();},300);
  }
  reset() {clearTimeout(this.timer);this.draft=normalizeState(DEFAULT_APPEARANCE_STATE);this.version++;this.resetPending=true;this.show("Saving…");return this.flush();}
  retry() {if(!this.failed)return Promise.resolve();this.draft=this.failed;this.version++;this.show("Saving…");return this.flush();}
  external(next:AppearanceState) {if(equalAppearance(next,this.saved)||this.timer||!equalAppearance(this.draft,this.saved))return;this.saved=normalizeState(next);this.draft=this.saved;this.show("");}
  flush():Promise<void> {
    clearTimeout(this.timer);this.timer=undefined;
    const next=normalizeState(this.draft),revision=this.version,reset=this.resetPending;
    this.resetPending=false;
    this.task=this.task.then(async()=>{
      if(equalAppearance(next,this.saved)&&!reset){this.options.changed?.(this.draft,"");return;}
      if(!reset)this.emit("appearance_changed",next);
      try {
        await this.options.save(next);this.saved=next;this.failed=undefined;
        this.emit(reset?"appearance_reset":"appearance_saved",next);
        if(revision===this.version){this.draft=next;this.show("Saved");}
      } catch {
        this.failed=next;this.emit("appearance_failed",next,{reason:"storage",outcome:"failed"});
        if(revision===this.version){this.draft=this.saved;this.show("Could not save. Try again.");}
      }
    });return this.task;
  }
}
/** Per-context activity clock; an unchanged visible configuration is sampled once per 30-minute session. */
export function createAppearanceUsage(track:AppearanceTrack,entry:string) {
  let last="",lastActivity=0;
  return (state:AppearanceState,dark:boolean,visible=true)=>{
    if(!visible)return;const now=Date.now(),key=JSON.stringify(appearanceParams(state,dark));
    if(now-lastActivity>1800000)last="";lastActivity=now;
    if(key===last)return;last=key;track("appearance_used",{...appearanceParams(state,dark),entry_point:entry});
  };
}
