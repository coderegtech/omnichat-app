export interface DiffRow {left:string;right:string;kind:'context'|'change'|'meta';}
export function splitDiff(diff:string):DiffRow[]{
  const rows:DiffRow[]=[];const lines=diff.trimEnd().split('\n');
  for(let i=0;i<lines.length;){
    const line=lines[i]!;
    if(line.startsWith('---')||line.startsWith('+++')||line.startsWith('@@')||line.startsWith('\\')){
      rows.push({left:line,right:line,kind:'meta'});i++;continue;
    }
    if(line.startsWith('-')||line.startsWith('+')){
      const removed:string[]=[],added:string[]=[];
      while(i<lines.length&&(lines[i]!.startsWith('-')||lines[i]!.startsWith('+'))){
        const next=lines[i++]!;(next[0]==='-'?removed:added).push(next.slice(1));
      }
      for(let j=0;j<Math.max(removed.length,added.length);j++)rows.push({left:removed[j]??'',right:added[j]??'',kind:'change'});
    }else{rows.push({left:line.startsWith(' ')?line.slice(1):line,right:line.startsWith(' ')?line.slice(1):line,kind:'context'});i++;}
  }
  return rows;
}
