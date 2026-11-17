/** Pure advisory calculations. No reservations, game actions or persistent writes. */
export const SUPPLY_HORIZON_MIN=45, SUPPLY_LOW_MIN=10, SUPPLY_BANK_MAX_AGE=30*60_000;
export interface SupplyStock {name:string;carried:Record<string,number>;bank?:Record<string,number>;bankAt?:number;foods?:{name:string;count:number;heals:number}[]}
export interface SupplyDemand {receiver:string;action:string;target:string;item:string;perUnit:number;unitsPerMinute:number;basis:string;primary:boolean;unitsCap?:number}
export interface SupplyCoverage {key:string;demand:SupplyDemand;held:number;bankKnown:boolean;minutes:number;target:number;short:number;low:boolean;suppliers:{name:string;available:number;reserve:number;offer:number;items?:{name:string;count:number}[]}[]}
const amount=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.floor(v)):0;
export function currentSupply(s:SupplyStock,item:string,now:number):{held:number;bankKnown:boolean} {
    const bankKnown=!!s.bank&&Number.isFinite(s.bankAt)&&now-s.bankAt!>=0&&now-s.bankAt!<=SUPPLY_BANK_MAX_AGE;
    return {held:amount(s.carried[item])+(bankKnown?amount(s.bank?.[item]):0),bankKnown};
}
export function supplyCoverage(stocks:SupplyStock[],demands:SupplyDemand[],now=Date.now()):SupplyCoverage[] {
    const desired=(d:SupplyDemand)=>Math.min(2000,Math.ceil(d.perUnit*Math.min(SUPPLY_HORIZON_MIN*d.unitsPerMinute,d.unitsCap??Infinity)));
    const grouped=new Map<string,SupplyDemand>();
    for(const d of demands) {
        if(!d.item||!Number.isFinite(d.unitsPerMinute)||d.unitsPerMinute<=0||!Number.isFinite(d.perUnit)||d.perUnit<=0)continue;
        const key=`${d.receiver}:${d.item}`,old=grouped.get(key);
        if(!old||Number(d.primary)>Number(old.primary)||(d.primary===old.primary&&(desired(d)>desired(old)||(desired(d)===desired(old)&&d.perUnit*d.unitsPerMinute>old.perUnit*old.unitsPerMinute))))grouped.set(key,d);
    }
    const targets=new Map<string,number>();
    for(const [k,d] of grouped)targets.set(k,desired(d));
    return [...grouped].flatMap(([key,d]):SupplyCoverage[]=>{
        const owner=stocks.find(s=>s.name===d.receiver);if(!owner)return [];
        const {held,bankKnown}=currentSupply(owner,d.item,now),target=targets.get(key)!;
        if(target<=0)return [];
        const rate=d.perUnit*d.unitsPerMinute,minutes=held/rate;
        const low=bankKnown&&held<Math.min(target,Math.ceil(SUPPLY_LOW_MIN*rate));
        const short=Math.max(0,target-held);
        const suppliers=stocks.filter(s=>s.name!==d.receiver).flatMap(s=>{
            const v=currentSupply(s,d.item,now);
            // Stale banks are never offered. Carried stock alone remains observable.
            const food=d.item==='cooked food (nominal healing HP)';
            const foods=[...(s.foods??[])].sort((a,b)=>b.heals-a.heals||a.name.localeCompare(b.name));
            let keep=10,foodFloor=0;
            for(const f of foods){const n=Math.min(keep,f.count);foodFloor+=n*f.heals;keep-=n;}
            const reserve=Math.min(v.held,Math.max(food?foodFloor:10,Math.ceil(v.held*.25),targets.get(`${s.name}:${d.item}`)??0));
            const available=Math.max(0,v.held-reserve);
            let offer=Math.min(short,available);const items:{name:string;count:number}[]=[];
            if(food) {
                let remaining=offer;offer=0;
                for(const f of foods){const count=Math.min(f.count,Math.floor(remaining/f.heals));if(count>0){items.push({name:f.name,count});offer+=count*f.heals;remaining-=count*f.heals;}}
            }
            return available&&offer>0?[{name:s.name,available,reserve,offer,...(food?{items}:{})}]:[];
        }).sort((a,b)=>b.available-a.available||a.name.localeCompare(b.name));
        return [{key,demand:d,held,bankKnown,minutes,target,short,low,suppliers}];
    }).sort((a,b)=>Number(b.demand.primary)-Number(a.demand.primary)||Number(b.low)-Number(a.low)||a.minutes-b.minutes||a.key.localeCompare(b.key));
}
export function renderSupplyCoverage(rows:SupplyCoverage[]):string {
    if(!rows.length)return '';
    return ['SUPPLY COVERAGE (estimates; current observed stock overrides historical deliveries and old plans)',
        ...rows.slice(0,12).map(r=>`${r.demand.receiver} ${r.demand.primary?'MISSION':'routine'} ${r.demand.action}(${r.demand.target}): ${r.held} ${r.demand.item} observed; ~${r.minutes.toFixed(1)} min covered (${r.demand.basis}); ${r.bankKnown?'bank view <=30min old':'bank stale/unknown: verify before promises'}. Working target ${r.target} for up to45min${r.demand.unitsCap!==undefined?' (bounded by observed co-input stock)':''}; ${!r.bankKnown?'VERIFY BANK; coverage is a carried-stock lower bound':r.low?'REFILL DUE':'covered above refill threshold'}.${r.low?` Renew an agreed supply request for up to${r.short}; candidate suppliers with provisional reserves: ${r.suppliers.map(s=>`${s.name} can propose up to${s.offer}${s.items?` healing HP as ${s.items.map(i=>`${i.count} ${i.name}`).join(" + ")}`:""} (observed surplus ${s.available}, keep ${s.reserve})`).join('; ')||'none observed; negotiate sourcing'}.`:''}`),
        'Food quantities are nominal healing HP, not item names: choose supported cooked fish and convert using their healing values. Owned bank notes are transport stock, not process-ready ingredients. Below10min coverage, renew supply toward45min; a completed delivery is history, not permanent readiness. Fallback work does not close an uncovered dependency. No candidate is assigned or reserved: agree giver, receiver, quantity, reserve, safe meeting and receiving capacity. Reconcile competing/partial requests against fresh stock. Use bank notes for bulk only where supported; receiver deposits and withdraws usable batches. Verify actual transferred amount. Mining and banking is not delivery. Until agreement this is an unaccepted suggestion, not a supply guarantee.'].join('\n');
}
export function createSupplyMonitor(o:{ready:()=>boolean;rows:()=>SupplyCoverage[];notice:(text:string)=>void;council:()=>void;now?:()=>number}) {
    const sent=new Map<string,number>();
    return ()=>{
        if(!o.ready())return;
        const now=o.now?.()??Date.now();
        for(const r of o.rows().filter(r=>r.low)) {
            if(now-(sent.get(r.key)??-Infinity)<15*60_000)continue;
            sent.set(r.key,now);
            o.notice(`Supply refill due: ${r.demand.receiver} has ${r.held} ${r.demand.item}, ~${r.minutes.toFixed(1)} estimated min for ${r.demand.action}(${r.demand.target}); renew an agreed request toward ${r.target}. Historical delivery does not cover consumed stock. Candidate surplus: ${r.suppliers.map(s=>`${s.name} up to${s.offer}${s.items?` HP (${s.items.map(i=>`${i.count} ${i.name}`).join(" + ")})`:""}`).join(', ')||'none observed; arrange sourcing'}.`);
            o.council();
        }
    };
}
