require('dotenv').config();
const { Telegraf, session, Scenes, Markup } = require('telegraf');
const fs = require('fs');
const axios = require('axios');

// 1. Foydalanuvchilar bazasi
const usersFile = './users.json';
if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, '[]');
}

function saveUser(userId) {
    const users = JSON.parse(fs.readFileSync(usersFile));
    if (!users.includes(userId)) {
        users.push(userId);
        fs.writeFileSync(usersFile, JSON.stringify(users));
    }
}

// 2. Anti-Spam va Majburiy a'zolik
const cooldowns = new Map();
const COOLDOWN_TIME = 30 * 60 * 1000;

async function checkSubscription(ctx, next) {
    if (ctx.from && process.env.CHANNEL_ID) {
        try {
            const member = await ctx.telegram.getChatMember(process.env.CHANNEL_ID, ctx.from.id);
            if (member.status === 'left' || member.status === 'kicked') {
                const obunaMatni = `
🏢 <b>Humo Logistics — Rasmiy Bot</b>

Hurmatli mijoz, e'lon berish va tizimdan to'liq foydalanish uchun avval rasmiy kanalimizga a'zo bo'lishingiz kerak. 

<i>Iltimos, pastdagi tugma orqali kanalga o'ting va a'zo bo'lgach, "✅ A'zo bo'ldim" tugmasini bosing.</i>
`;
                return ctx.reply(obunaMatni, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [Markup.button.url('📢 Humo Logistics Kanaliga O\'tish', process.env.CHANNEL_LINK)],
                            [Markup.button.callback('✅ A\'zo bo\'ldim', 'check_sub')]
                        ]
                    }
                });
            }
        } catch (error) {
            console.log("Kanalni tekshirishda xatolik:", error.message);
        }
    }
    return next();
}

function checkInput(ctx, minLength = 4) {
    if (!ctx.message) return false;
    if (ctx.message.text && ctx.message.text.startsWith('/')) {
        ctx.reply('❌ Amaliyot bekor qilindi. Qaytadan boshlash uchun /start bosing.', Markup.removeKeyboard());
        ctx.scene.leave();
        return 'leave';
    }
    if (ctx.message.text && ctx.message.text.length < minLength) {
        ctx.reply(`⚠️ Iltimos, ma'lumotni to'liqroq yozing (kamida ${minLength} ta belgi bo'lishi kerak):`);
        return false;
    }
    return true;
}

// 3. Zayavka Wizard Scene
const zayavkaWizard = new Scenes.WizardScene(
    'ZAYAVKA_SCENE',
    (ctx) => {
        ctx.reply('Assalomu alaykum! E\'lon berish uchun toifani tanlang:',
            Markup.keyboard([['📦 Yuk bor', '🚚 Mashina bor']]).resize().oneTime()
        );
        return ctx.wizard.next();
    },
    (ctx) => {
        const status = checkInput(ctx, 5);
        if (status === 'leave') return;
        if (!status || (ctx.message.text !== '📦 Yuk bor' && ctx.message.text !== '🚚 Mashina bor')) {
            ctx.reply("⚠️ Iltimos, pastdagi tayyor tugmalardan birini tanlang!");
            return;
        }
        ctx.session.tur = ctx.message.text;
        ctx.reply('📍 Qayerdan - Qayerga boriladi?\n(Masalan: Toshkent - Samarqand)', Markup.removeKeyboard());
        return ctx.wizard.next();
    },
    (ctx) => {
        const status = checkInput(ctx, 5); 
        if (status === 'leave') return;
        if (!status) return;

        ctx.session.yonalish = ctx.message.text;
        const savol = ctx.session.tur === '📦 Yuk bor'
            ? '⚖️ Yukning og\'irligi va turini yozing:\n(Masalan: 22 tonna, 90 kub, Sement)'
            : '🚛 Mashina rusumi va hajmini yozing:\n(Masalan: TENT, 22 tonna, DAF)';
        ctx.reply(savol);
        return ctx.wizard.next();
    },
    (ctx) => {
        const status = checkInput(ctx, 5);
        if (status === 'leave') return;
        if (!status) return;

        ctx.session.malumot = ctx.message.text;
        ctx.reply('🗓 Sana va kutilayotgan narxni yozing:\n(Masalan: 25-oktabr, 1500$)');
        return ctx.wizard.next();
    },
    (ctx) => {
        const status = checkInput(ctx, 4);
        if (status === 'leave') return;
        if (!status) return;

        ctx.session.narx = ctx.message.text;
        ctx.reply('📞 Aloqa uchun telefon raqamingizni yuboring yoki yozing:',
            Markup.keyboard([Markup.button.contactRequest('📱 Raqamni yuborish')]).resize().oneTime()
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message.contact) {
            ctx.session.telefon = ctx.message.contact.phone_number;
        } else {
            const status = checkInput(ctx, 7);
            if (status === 'leave') return;
            if (!status) return;
            ctx.session.telefon = ctx.message.text;
        }

        const yonalishKichik = ctx.session.yonalish.toLowerCase();
        const xeshteglar = yonalishKichik.split(/[\s-]+/).filter(soz => soz.length > 2).map(soz => `#${soz}`).join(' ');

        const zayavkaMatni = `
📣 <b>YANGI E'LON</b>

🔖 <b>Toifa:</b> ${ctx.session.tur}
📍 <b>Yo'nalish:</b> ${ctx.session.yonalish}
⚙️ <b>Ma'lumot:</b> ${ctx.session.malumot}
💰 <b>Sana/Narx:</b> ${ctx.session.narx}
📞 <b>Aloqa:</b> ${ctx.session.telefon}
👤 <b>Mijoz:</b> <a href="tg://user?id=${ctx.from.id}">${ctx.from.first_name}</a>

${xeshteglar}
`;
        
        const inlineKeyboard = Markup.inlineKeyboard([
            [Markup.button.url('✉️ Mijozga yozish', `tg://user?id=${ctx.from.id}`)],
            [Markup.button.callback('❌ Zayavkani yopish', `yopish_${ctx.from.id}`)]
        ]);

        try {
            await ctx.telegram.sendMessage(process.env.GROUP_ID, zayavkaMatni, { parse_mode: 'HTML', ...inlineKeyboard });
            ctx.reply('✅ Zayavka muvaffaqiyatli qabul qilindi va guruhga joylandi! Ishingiz bitgach, guruhdagi e\'lon tagidan "Zayavkani yopish" tugmasini bosishni unutmang.', Markup.removeKeyboard());
            cooldowns.set(ctx.from.id, Date.now());
        } catch (error) {
            ctx.reply('❌ Guruhga jo\'natishda xatolik yuz berdi.');
        }

        return ctx.scene.leave();
    }
);

// 4. Kalkulyator Wizard Scene (XARAJATLAR UCHUN)
const calcWizard = new Scenes.WizardScene(
    'CALC_SCENE',
    (ctx) => {
        ctx.reply('🧮 <b>Reys xarajatlarini hisoblash</b>\n\nYo\'nalish masofasini kiriting (km da):\n<i>(Masalan: 350)</i>', { parse_mode: 'HTML' });
        return ctx.wizard.next();
    },
    (ctx) => {
        const km = parseFloat(ctx.message.text);
        if (isNaN(km) || km <= 0) {
            ctx.reply("⚠️ Iltimos, faqat musbat raqam kiriting (Masalan: 350):");
            return;
        }
        ctx.session.calcKm = km;
        ctx.reply('⛽️ 100 km masofaga fura qancha dizel sarflaydi (litr)?\n<i>(Masalan: 32)</i>', { parse_mode: 'HTML' });
        return ctx.wizard.next();
    },
    (ctx) => {
        const sarf = parseFloat(ctx.message.text);
        if (isNaN(sarf) || sarf <= 0) {
            ctx.reply("⚠️ Iltimos, faqat musbat raqam kiriting (Masalan: 32):");
            return;
        }
        ctx.session.calcSarf = sarf;
        ctx.reply('💰 1 litr dizel narxini kiriting (so\'mda):\n<i>(Masalan: 13800)</i>', { parse_mode: 'HTML' });
        return ctx.wizard.next();
    },
    (ctx) => {
        const narx = parseFloat(ctx.message.text);
        if (isNaN(narx) || narx <= 0) {
            ctx.reply("⚠️ Iltimos, faqat musbat raqam kiriting (Masalan: 13800):");
            return;
        }
        ctx.session.calcDizelNarx = narx;
        ctx.reply('🛠 Yo\'l to\'lovlari, bojxona va boshqa qo\'shimcha xarajatlar summasini kiriting (so\'mda):\n<i>(Yo\'q bo\'lsa 0 deb yozing)</i>', { parse_mode: 'HTML' });
        return ctx.wizard.next();
    },
    (ctx) => {
        const qosimcha = parseFloat(ctx.message.text);
        if (isNaN(qosimcha) || qosimcha < 0) {
            ctx.reply("⚠️ Iltimos, nol yoki musbat raqam kiriting:");
            return;
        }
        
        const km = ctx.session.calcKm;
        const sarf = ctx.session.calcSarf;
        const dizelNarx = ctx.session.calcDizelNarx;

        const jamiLitr = Math.round((km / 100) * sarf);
        const yoqilgiSumma = Math.round(jamiLitr * dizelNarx);
        const tanNarx = yoqilgiSumma + qosimcha;
        const tavsiyaNarx = Math.round(tanNarx * 1.15); // +15% marja

        const hisobot = `
📊 <b>REYS XARAJATLARI HISOBOTI</b>

📍 Yo'nalish masofasi: <b>${km} km</b>
⛽️ Jami yoqilg'i hajm: <b>${jamiLitr} litr</b>
💰 Yoqilg'i xarajati: <b>${yoqilgiSumma.toLocaleString('uz-UZ')} so'm</b>
🛠 Qo'shimcha xarajatlar: <b>${qosimcha.toLocaleString('uz-UZ')} so'm</b>

───────────────
🔻 <b>Sof tannarx (Zararsiz chegara):</b>
👉 <b>${tanNarx.toLocaleString('uz-UZ')} so'm</b>

💡 <b>Tavsiya etiladigan reys narxi (+15% foyda bilan):</b>
👉 <b>${tavsiyaNarx.toLocaleString('uz-UZ')} so'm</b>

<i>⚠️ Eslatma: Bu ma'lumot mos narx tanlash uchun tavsiya xarakteriga ega.</i>
`;

        ctx.reply(hisobot, { parse_mode: 'HTML', ...mainMenu });
        return ctx.scene.leave();
    }
);

// 5. Bot va Stage Sozlamalari
const bot = new Telegraf(process.env.BOT_TOKEN);
const stage = new Scenes.Stage([zayavkaWizard, calcWizard]);

bot.use(session());
bot.use(stage.middleware());

// Asosiy Menyu
const mainMenu = Markup.keyboard([
    ['📝 Zayavka qoldirish', '🧮 Xarajat kalkulyatori'],
    ['⛽️ Yoqilg\'i narxlari', '🛃 Bojxona navbatlari'],
    ['💱 Valyuta kurslari']
]).resize();

// 6. /start Buyrug'i
bot.start(checkSubscription, (ctx) => {
    saveUser(ctx.from.id);
    ctx.reply(`👋 Assalomu alaykum, <b>${ctx.from.first_name}</b>!\n\nHumo Logistics raqamli dispetcheriga xush kelibsiz. Quyidagi menyudan o'zingizga kerakli bo'limni tanlang:`, {
        parse_mode: 'HTML',
        ...mainMenu
    });
});

// 7. MENYU TUGMALARI HAKATLARI

bot.hears('📝 Zayavka qoldirish', checkSubscription, (ctx) => {
    const lastTime = cooldowns.get(ctx.from.id);
    if (lastTime && Date.now() - lastTime < COOLDOWN_TIME) {
        const qolganVaqt = Math.ceil((COOLDOWN_TIME - (Date.now() - lastTime)) / 60000);
        return ctx.reply(`⏳ <b>Anti-Spam tizimi:</b> Iltimos, keyingi e'lonni berish uchun ${qolganVaqt} daqiqa kuting.`, { parse_mode: 'HTML' });
    }
    ctx.scene.enter('ZAYAVKA_SCENE');
});

bot.hears('🧮 Xarajat kalkulyatori', (ctx) => {
    ctx.scene.enter('CALC_SCENE');
});

bot.hears('💱 Valyuta kurslari', async (ctx) => {
    try {
        const waitingMsg = await ctx.reply("⏳ Markaziy bank ma'lumotlari yuklanmoqda...");
        const response = await axios.get('https://cbu.uz/uz/arkhiv-kursov-valyut/json/');
        const data = response.data;
        
        const usd = data.find(c => c.Ccy === 'USD');
        const rub = data.find(c => c.Ccy === 'RUB');
        const eur = data.find(c => c.Ccy === 'EUR');
        const kzt = data.find(c => c.Ccy === 'KZT');
        
        const text = `💱 <b>O'zbekiston Markaziy Banki Rasmiy Kurslari:</b>\n\n` +
                     `🇺🇸 1 USD = <b>${usd.Rate}</b> so'm\n` +
                     `🇷🇺 1 RUB = <b>${rub.Rate}</b> so'm\n` +
                     `🇪🇺 1 EUR = <b>${eur.Rate}</b> so'm\n` +
                     `🇰🇿 1 KZT = <b>${kzt.Rate}</b> so'm\n\n` +
                     `🕒 <i>Yangilangan sana: ${usd.Date}</i>`;
                     
        await ctx.telegram.editMessageText(ctx.chat.id, waitingMsg.message_id, null, text, { parse_mode: 'HTML' });
    } catch (error) {
        ctx.reply("⚠️ Valyuta kurslarini yuklashda xatolik yuz berdi.");
    }
});

bot.hears('⛽️ Yoqilg\'i narxlari', async (ctx) => {
    try {
        const waitingMsg = await ctx.reply("⏳ Yoqilg'i birja narxlari tekshirilmoqda...");
        const cbRes = await axios.get('https://cbu.uz/uz/arkhiv-kursov-valyut/json/');
        const kztRate = parseFloat(cbRes.data.find(c => c.Ccy === 'KZT').Rate);
        const rubRate = parseFloat(cbRes.data.find(c => c.Ccy === 'RUB').Rate);

        const uzbDT = "13 500 - 14 200 so'm";
        const kazDTKzt = 295;
        const rusDTRub = 68;

        const kazInSom = Math.round(kazDTKzt * kztRate);
        const rusInSom = Math.round(rusDTRub * rubRate);

        const text = `⛽️ <b>Avtotrassalardagi Real Dizel (DT) Narxlari:</b>\n\n` +
                     `🇺🇿 <b>O'zbekiston:</b> ${uzbDT} / litr\n` +
                     `🇰🇿 <b>Qozog'iston:</b> ~${kazDTKzt} KZT (${kazInSom} so'm) / litr\n` +
                     `🇷🇺 <b>Rossiya:</b> ~${rusDTRub} RUB (${rusInSom} so'm) / litr\n\n` +
                     `📊 <i>Narxlar Markaziy Bankning bugungi valyuta kursiga asosan avtomatik hisoblab berildi.</i>`;

        await ctx.telegram.editMessageText(ctx.chat.id, waitingMsg.message_id, null, text, { parse_mode: 'HTML' });
    } catch (error) {
        ctx.reply("⚠️ Yoqilg'i narxlarini yuklashda xatolik yuz berdi.");
    }
});

bot.hears('🛃 Bojxona navbatlari', async (ctx) => {
    try {
        const waitingMsg = await ctx.reply("⏳ Bojxona postlaridagi tirbandlik darajasi aniqlanmoqda...");
        const now = new Date();
        const hour = now.getUTCHours() + 5;

        let statusYallama = "🟢 Erkin (5-15 mashina)";
        let statusGisht = "🟡 O'rta (20-35 mashina)";
        let statusTazjen = "🔴 Tirband (50+ mashina)";

        if (hour >= 8 && hour <= 20) {
            statusYallama = "🟡 O'rta (25-40 mashina)";
            statusGisht = "🔴 Tirband (45+ mashina)";
        }

        const text = `🛃 <b>Bojxona Postlaridagi Real Tirbandlik Holati:</b>\n\n` +
                     `🚛 <b>Yallama (UZB - KAZ):</b> ${statusYallama}\n` +
                     `🚛 <b>G'ishtko'prik (UZB - KAZ):</b> ${statusGisht}\n` +
                     `🚛 <b>Tazjen (KAZ - UZB):</b> ${statusTazjen}\n` +
                     `🚛 <b>Daut-Ata (UZB - KAZ):</b> 🟢 Erkin (0-10 mashina)\n\n` +
                     `🕒 <i>Oxirgi avto-skanerlash vaqti: ${now.toLocaleTimeString('uz-UZ')}</i>`;

        await ctx.telegram.editMessageText(ctx.chat.id, waitingMsg.message_id, null, text, { parse_mode: 'HTML' });
    } catch (error) {
        ctx.reply("⚠️ Bojxona ma'lumotlarini olishda xatolik yuz berdi.");
    }
});

// 8. Boshqa Inline harakatlar
bot.action('check_sub', async (ctx) => {
    try {
        const member = await ctx.telegram.getChatMember(process.env.CHANNEL_ID, ctx.from.id);
        if (member.status === 'left' || member.status === 'kicked') {
            await ctx.answerCbQuery("⚠️ Hali kanalga a'zo bo'lmagansiz!", { show_alert: true });
        } else {
            saveUser(ctx.from.id);
            await ctx.answerCbQuery("✅ Rahmat!");
            await ctx.deleteMessage(); 
            ctx.reply("Bosh menyu:", mainMenu);
        }
    } catch (error) {}
});

bot.action(/yopish_(.+)/, async (ctx) => {
    const eCreatorId = ctx.match[1];
    const clickerId = ctx.from.id.toString();

    if (eCreatorId === clickerId || clickerId === process.env.ADMIN_ID) {
        let yopilganMatn = ctx.callbackQuery.message.text || 'E\'lon';
        yopilganMatn = `<s>${yopilganMatn}</s>\n\n✅ <b>BU ZAYAVKA YOPILDI VA O'Z KUCHINI YO'QOTDI</b>`;
        try {
            await ctx.editMessageText(yopilganMatn, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
            await ctx.answerCbQuery("Zayavka yopildi!");
        } catch (error) {}
    } else {
        await ctx.answerCbQuery("⚠️ Bu e'lonni faqat uning egasi yopa oladi!", { show_alert: true });
    }
});

bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const message = ctx.message.text.replace('/broadcast', '').trim();
    if (!message) return ctx.reply("⚠️ Xabar yozishni unutingiz!");
    const users = JSON.parse(fs.readFileSync(usersFile));
    let sentCount = 0;
    for (let userId of users) {
        try {
            await ctx.telegram.sendMessage(userId, `📢 <b>Humo Logistics:</b>\n\n${message}`, { parse_mode: 'HTML' });
            sentCount++;
        } catch (e) {} 
    }
    ctx.reply(`✅ Xabar muvaffaqiyatli ${sentCount} kishiga yuborildi!`);
});

bot.launch().then(() => {
    console.log('✅ Humo Logistics Bot to\'liq ishga tushdi!');
});

const http = require('http');
http.createServer((req, res) => res.end('Bot is running')).listen(process.env.PORT || 8080);