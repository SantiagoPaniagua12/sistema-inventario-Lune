import {processShiftBackups} from '../../lib/shift-backups';

// Netlify invokes scheduled functions privately, even if nobody opens the app.
export const config={schedule:'*/15 * * * *'};
export default async function(){
  try{
    const result=await processShiftBackups({limit:1});
    console.log('lune.backup.retry',result);
    return new Response(null,{status:204});
  }catch{
    console.error('lune.backup.failure',{code:'BACKUP_WORKER'});
    return new Response(null,{status:500});
  }
}
