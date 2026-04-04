const token = 'pk_290604780_AQR858MXPB4T5TW121XIQYZQ3FVZQC0V';

async function fetchClickUp() {
  try {
    const teamRes = await fetch('https://api.clickup.com/api/v2/team', { headers: { 'Authorization': token }});
    const teamData = await teamRes.json();
    
    if (!teamData.teams || teamData.teams.length === 0) {
      console.log('No teams found', teamData);
      return;
    }
    
    const teamId = teamData.teams[0].id;
    console.log(`Team: ${teamData.teams[0].name} (${teamId})`);
    
    const spaceRes = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/space`, { headers: { 'Authorization': token }});
    const spaceData = await spaceRes.json();
    
    for (const space of spaceData.spaces || []) {
      console.log(`\nSpace: ${space.name} (${space.id})`);
      
      const folderRes = await fetch(`https://api.clickup.com/api/v2/space/${space.id}/folder`, { headers: { 'Authorization': token }});
      const folderData = await folderRes.json();
      
      for (const folder of folderData.folders || []) {
        console.log(`  Folder: ${folder.name} (${folder.id})`);
        
        const listRes = await fetch(`https://api.clickup.com/api/v2/folder/${folder.id}/list`, { headers: { 'Authorization': token }});
        const listData = await listRes.json();
        
        for (const list of listData.lists || []) {
          console.log(`    List: ${list.name} (${list.id})`);
        }
      }
      
      const spaceListRes = await fetch(`https://api.clickup.com/api/v2/space/${space.id}/list`, { headers: { 'Authorization': token }});
      const spaceListData = await spaceListRes.json();
      for (const list of spaceListData.lists || []) {
        console.log(`  Folderless List: ${list.name} (${list.id})`);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

fetchClickUp();
