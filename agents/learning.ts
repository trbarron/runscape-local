import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,statSync} from 'fs';
import {join,dirname} from 'path';
import type {AgentEvent} from './events';
import {newPilot,ambitionInvitationDue,validLearningState,captureObservation,applyLearning,learningContext,type LearningState} from './learning-pilot';
export interface LearningIO {exists:()=>boolean;read:()=>unknown;write:(s:LearningState)=>void}
/** No initialization, subscriptions or file writes on import. Controller explicitly starts the pilot. */
export class LearningPilotStore {
    private state?:LearningState;
    private disabled=false;
    private warned=new Set<string>();
    private reporter:(text:string)=>void=()=>{};
    constructor(private io:LearningIO){}
    setReporter(fn:(text:string)=>void):void{this.reporter=fn;}
    private warn(text:string):void {
        if(this.warned.has(text)||this.warned.size>=8)return;this.warned.add(text);
        try{this.reporter(text);}catch{} // observation must never break gameplay/event dispatch
    }
    private get():LearningState|undefined {
        if(this.disabled)return;
        if(this.state)return this.state;
        try {
            if(!this.io.exists())return;
            const s=this.io.read();
            if(!validLearningState(s))throw Error('invalid or unsupported learning state; preserve file and repair before restart');
            this.state=s;return s;
        } catch(e) {this.disabled=true;this.warn(`learning disabled: ${String(e).slice(0,180)}`);}
    }
    private persist(s:LearningState):boolean {
        try{this.io.write(s);this.state=s;return true;}
        catch(e){this.warn(`learning save failed; previous state retained: ${String(e).slice(0,180)}`);return false;}
    }
    initialize(now=Date.now()):void {
        if(this.get()||this.disabled)return;
        if(!this.persist(newPilot(now)))this.disabled=true;
    }
    handle(e:AgentEvent,run:string):void {
        try{const s=this.get();if(!s)return;const next=captureObservation(s,e,run,Date.now());if(next)this.persist(next);}
        catch(e){this.warn(`learning capture skipped: ${String(e).slice(0,180)}`);}
    }
    accept(author:string,ambition:unknown,note:unknown,now=Date.now()):{changed:boolean;warning?:string} {
        try {
            const s=this.get();if(!s)return {changed:false};
            const result=applyLearning(s,author,ambition,note,now);
            if(result.next&&!this.persist(result.next))return {changed:false,warning:'Learning update was not saved; existing learning state is unchanged.'};
            return {changed:!!result.next,warning:result.warning};
        }catch(e){this.warn(`learning update skipped: ${String(e).slice(0,180)}`);return {changed:false};}
    }
    acceptDecision(author:string,d:{lookup?:string|null;ambition?:unknown;field_note?:unknown},accepted:boolean):{changed:boolean;warning?:string} {
        if(!accepted||d.lookup?.trim())return {changed:false};
        return this.accept(author,d.ambition,d.field_note);
    }
    invitationDue(author:string,invitedAt?:number):boolean {
        const s=this.get();return !!s&&ambitionInvitationDue(s,author,invitedAt);
    }
    context(author:string,query:string):string {
        try{const s=this.get();return s?learningContext(s,author,query):'';}
        catch(e){this.warn(`learning retrieval skipped: ${String(e).slice(0,180)}`);return '';}
    }
    snapshot():LearningState|undefined{const s=this.get();return s?structuredClone(s):undefined;}
}
const file=join(import.meta.dir,'state/learning-pilot.json');
export const learning=new LearningPilotStore({exists:()=>existsSync(file),read:()=>{
    if(statSync(file).size>1_000_000)throw Error('learning file exceeds1MB');
    return JSON.parse(readFileSync(file,'utf8'));
},write:s=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file+'.tmp',JSON.stringify(s,null,2));renameSync(file+'.tmp',file);}});
