import { BookOpenIcon, NotebookIcon, HeartIcon, WalletIcon, FlowerLotusIcon, CalendarBlankIcon, PencilSimpleIcon, TrashIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type {Entry,EntryInput,EntryKind} from '../../shared/contracts';
import {money} from '../../lib/utils';
import {Button} from '../ui/button';
export const kindInfo:Record<EntryKind,{label:string;plural:string;icon:typeof BookOpenIcon;hint:string}>= {
 note:{label:'笔记',plural:'随手笔记',icon:BookOpenIcon,hint:'留住一句触动你的话'},
 diary:{label:'日记',plural:'心情日记',icon:NotebookIcon,hint:'给今天的自己留几句话'},
 merit:{label:'功过格',plural:'功过省察',icon:HeartIcon,hint:'如实观照，温柔改进'},
 ledger:{label:'账目',plural:'生活账本',icon:WalletIcon,hint:'让每一笔收支清楚安放'},
 practice:{label:'功课',plural:'每日功课',icon:FlowerLotusIcon,hint:'一声一念，都在当下'},
 schedule:{label:'日程',plural:'日程安排',icon:CalendarBlankIcon,hint:'为重要的事情留一点时间'}
};
export function EntrySummary({entry}:{entry:EntryInput}){
 const info=kindInfo[entry.kind];const Icon=info.icon;
 return <><div className="entry-label"><Icon size={18}/><span>{info.label}</span><time>{entry.date}</time></div><h3>{entry.title}</h3>{entry.kind==='practice'&&entry.extra.count!==undefined&&<div className="entry-value">{entry.extra.count.toLocaleString()} <small>{entry.extra.unit||'声'}</small></div>}{entry.kind==='ledger'&&<div className="entry-value">{entry.extra.direction==='expense'?'−':'＋'}{money(entry.extra.amountCents||0)}</div>}{entry.kind==='schedule'&&entry.extra.dueAt&&<p className="schedule-date">{new Date(entry.extra.dueAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}<span> · 北京时间</span></p>}{entry.content&&<p className="entry-content">{entry.content}</p>}{entry.extra.completed&&<span className="status-tag"><CheckCircleIcon/>已完成</span>}</>;
}
export function EntryCard({entry,onEdit,onDelete,canWrite}:{entry:Entry;onEdit:(entry:Entry)=>void;onDelete:(entry:Entry)=>void;canWrite:boolean}){return <article className="entry-card"><EntrySummary entry={entry}/>{canWrite&&<div className="entry-actions"><Button variant="ghost" size="sm" aria-label={`编辑${entry.title}`} onClick={()=>onEdit(entry)}><PencilSimpleIcon size={15}/>编辑</Button><Button variant="ghost" size="sm" aria-label={`删除${entry.title}`} onClick={()=>onDelete(entry)}><TrashIcon size={15}/>删除</Button></div>}</article>}
