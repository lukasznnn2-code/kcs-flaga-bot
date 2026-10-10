const fetch = require('node-fetch');

let colorCounter = 0;

function formatMessage(attack) {
  const hasSnob = attack.hasSnob;
  const borderColor = hasSnob ? '🟥' : (colorCounter++ % 2 === 0 ? '🟦' : '🟨');
  
  const sep = '━'.repeat(22);
  const border = borderColor.repeat(22);
  const unitName = attack.units.length === 1 
    ? attack.units[0].name 
    : attack.units.map(u => u.name).join(' + ');
  
  let msg = `${sep}\n${border}\n`;
  msg += `⚔️ **${attack.targetPlayer}**\n`;
  msg += `**${unitName}**\n`;
  msg += ` **Obrońca:** **${attack.targetPlayer}**\n`;
  msg += ` **Cel:** \`${attack.targetCoords}\`\n`;
  msg += `⏰ **${attack.arrivalDate}**\n`;
  if (attack.returnDate) msg += `🔙 **Powrót wojsk:** __${attack.returnDate}__\n`;
  msg += `${sep}\n`;
  msg += `⚔️ **Atakujący:** **${attack.sourcePlayer}**\n`;
  msg += `📍 **Skąd:** \`${attack.sourceCoords}\`\n`;
  if (attack.sourceAlly) msg += ` **Sojusz:** **${attack.sourceAlly}**\n`;
  msg += `\n${border}\n${sep}\n`;
  
  return msg;
}

module.exports = async (req, res) => {
  try {
    const { attacks, webhookUrl } = req.body;
    
    if (!webhookUrl || !webhookUrl.includes('discord.com/api/webhooks/')) {
      return res.status(400).json({ ok: false, error: 'Invalid webhook URL' });
    }
    
    if (!attacks || attacks.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }
    
    const byDefender = {};
    for (const a of attacks) {
      if (!byDefender[a.targetPlayer]) byDefender[a.targetPlayer] = [];
      byDefender[a.targetPlayer].push(a);
    }
    
    let sent = 0;
    for (const [defender, list] of Object.entries(byDefender)) {
      const msg = list.map(formatMessage).join('\n');
      
      const discordRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: msg,
          username: 'KingsAge Bot',
          avatar_url: 'https://i.imgur.com/AfFp7pu.png'
        })
      });
      
      if (discordRes.ok) sent++;
      
      await new Promise(r => setTimeout(r, 1100));
    }
    
    res.status(200).json({ ok: true, sent });
  } catch (e) {
    console.error('[DISCORD] Błąd:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
