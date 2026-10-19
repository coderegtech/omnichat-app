/** Line-based unified diff for review cards. Common prefix/suffix are trimmed
 * first; very large middles fall back to one replacement hunk instead of an
 * unbounded LCS table. */
type Op = {kind:' '|'-'|'+';text:string;a:number;b:number};
const CONTEXT = 3;
const MAX_CELLS = 4_000_000;

function lines(text:string) {const parts=text.split('\n');if(parts.at(-1)==='')parts.pop();return parts;}

function operations(a:string[],b:string[]):Op[] {
  let start=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
  let endA=a.length,endB=b.length;while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
  const ops:Op[]=[];for(let i=0;i<start;i++)ops.push({kind:' ',text:a[i]!,a:i,b:i});
  const midA=a.slice(start,endA),midB=b.slice(start,endB);
  if(midA.length*midB.length>MAX_CELLS) {
    midA.forEach((text,i)=>ops.push({kind:'-',text,a:start+i,b:start}));
    midB.forEach((text,i)=>ops.push({kind:'+',text,a:endA,b:start+i}));
  } else {
    const n=midA.length,m=midB.length;const table=new Uint32Array((n+1)*(m+1));
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)table[i*(m+1)+j]=midA[i]===midB[j]?table[(i+1)*(m+1)+j+1]!+1:Math.max(table[(i+1)*(m+1)+j]!,table[i*(m+1)+j+1]!);
    let i=0,j=0;
    while(i<n||j<m) {
      if(i<n&&j<m&&midA[i]===midB[j]){ops.push({kind:' ',text:midA[i]!,a:start+i,b:start+j});i++;j++;}
      else if(j<m&&(i>=n||table[i*(m+1)+j+1]!>table[(i+1)*(m+1)+j]!)){ops.push({kind:'+',text:midB[j]!,a:start+i,b:start+j});j++;}
      else {ops.push({kind:'-',text:midA[i]!,a:start+i,b:start+j});i++;}
    }
  }
  for(let i=0;i<a.length-endA;i++)ops.push({kind:' ',text:a[endA+i]!,a:endA+i,b:endB+i});
  return ops;
}

export function unifiedDiff(path:string,before:string|null,after:string|null):string {
  const a=before===null?[]:lines(before),b=after===null?[]:lines(after);
  const ops=operations(a,b);const header=`--- ${before===null?'/dev/null':'a/'+path}\n+++ ${after===null?'/dev/null':'b/'+path}\n`;
  const changed=ops.map((op,index)=>op.kind===' '?-1:index).filter(index=>index>=0);
  if(!changed.length)return header;
  const hunks:[number,number][]=[];
  for(const index of changed) {
    const from=Math.max(0,index-CONTEXT),to=Math.min(ops.length-1,index+CONTEXT);const last=hunks.at(-1);
    if(last&&from<=last[1]+1)last[1]=Math.max(last[1],to);else hunks.push([from,to]);
  }
  let out=header;
  for(const [from,to] of hunks) {
    const slice=ops.slice(from,to+1);const first=slice[0]!;
    const countA=slice.filter(op=>op.kind!=='+').length,countB=slice.filter(op=>op.kind!=='-').length;
    out+=`@@ -${countA?first.a+1:first.a},${countA} +${countB?first.b+1:first.b},${countB} @@\n`;
    for(const op of slice)out+=op.kind+op.text+'\n';
  }
  return out;
}
