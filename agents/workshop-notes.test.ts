import { expect, test } from 'bun:test';
import type { BotWorldState } from '../rs-sdk/sdk/types';
import { smithingNotes, opportunityNotes } from './workshop-notes';
const state=(level:number)=>({skills:[{name:'Smithing',baseLevel:level}]} as BotWorldState);
const bank={t:1000,items:{'Iron ore':100,Coal:40,'Mithril ore':6,'Adamantite ore':50}};

test('compares eligible metals using own ore ratios, including zero banked bars',()=>{
    const text=smithingNotes(state(65),bank,61000);
    expect(text).toContain('mithril: 50 base Smithing XP/bar; 0 banked bars; own bank has inputs for 6 more');
    expect(text).toContain('steel: 37.5 base Smithing XP/bar; 0 banked bars; own bank has inputs for 20 more');
    expect(text).toContain('iron: 25 base Smithing XP/bar');
    expect(text.indexOf('- mithril:')).toBeLessThan(text.indexOf('- iron:'));
    expect(text).toContain('1 min old');
    expect(text).toContain('inventory-sized batches');
    expect(text).not.toContain('- adamantite:');
    expect(text).toContain('Next metal unlock: adamantite at Smithing 70');
});
test('locked metals are never offered as usable methods and coal limits their supply',()=>{
    expect(smithingNotes(state(49),bank)).not.toContain('- mithril:');
    expect(smithingNotes(state(70),bank)).toContain('- adamantite: 62.5 base Smithing XP/bar; 0 banked bars; own bank has inputs for 6 more');
    expect(smithingNotes(state(65),{t:1000,items:{'Mithril ore':500}})).not.toContain('- mithril:');
});
test('no comparison is invented from unknown banks or beginner levels',()=>{
    expect(smithingNotes(state(65))).toBe('');
    expect(smithingNotes(state(1),bank)).toBe('');
    expect(smithingNotes(state(65),{t:1000,items:{}})).toBe('');
});
test('banked bars remain a usable option without fresh ore or coal',()=>{
    expect(smithingNotes(state(65),{t:1000,items:{'Mithril bar':1}})).toContain('mithril: 50 base Smithing XP/bar; 1 banked bar;');
});

test('ore batches respect ratios and reserve space rather than promise the level target', () => {
    const text = smithingNotes(state(70), bank);
    expect(text).toContain('Example ore batch: 3 bars worth of inputs'); // adamant 1+6
    expect(text).toContain('Example ore batch: 4 bars worth of inputs'); // mithril 1+4
    expect(text).toContain('Example ore batch: 7 bars worth of inputs'); // steel 2+1
    expect(text).toContain('smith until exhausted');
});
test('opportunities only offer owned wearable adamant and retain appearance choice', () => {
    const s = { skills: [{ name: 'Attack', baseLevel: 42 }, { name: 'Defence', baseLevel: 1 },
        { name: 'Firemaking', baseLevel: 1 }, { name: 'Fletching', baseLevel: 1 }],
        inventory: [], equipment: [] } as unknown as BotWorldState;
    const text = opportunityNotes(s, { t: 1000, items: { 'Adamant dagger': 1, 'Adamant platelegs': 1 } });
    expect(text).toContain('Adamant dagger');
    expect(text).not.toContain('Adamant platelegs');
    expect(text).toContain('individuality');
    expect(text).toContain('Firemaking or Fletching');
    expect(text).toContain('arrow shafts at Fletching 1 / shortbows at 5');
    s.equipment = [{ name: 'Adamant dagger' }] as BotWorldState['equipment'];
    expect(opportunityNotes(s)).not.toContain('Owned wearable');
    s.skills = [];
    expect(opportunityNotes(s)).toBe('');
});
