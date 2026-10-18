require('dotenv').config();
const { Telegraf, session, Scenes, Markup } = require('telegraf');
const fs = require('fs');

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

// BU YANGI HIMOYA FUNKSIYASI: Buyruqlarni ushlab qoladi
function isCommand(ctx) {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        ctx.reply('❌ Amaliyot bekor qilindi. Qaytadan boshlash uchun /start bosing.', Markup.removeKeyboard());
        ctx.scene.leave();
        return true;
    }
    return false;
}

// MA'LUMOTLARNI TEKSHIRISH UCHUN YANGI FUNKSIYA
function checkInput(ctx, minLength = 4) {
    if (!ctx.message) return false;
    
    // 1. Buyruqlarni tekshirish (/start, /cancel)
    if (ctx.message.text && ctx.message.text.startsWith('/')) {
        ctx.reply('❌ Amaliyot bekor qilindi. Qaytadan boshlash uchun /start bosing.', Markup.removeKeyboard());
        ctx.scene.leave();
        return 'leave';
    }
    
    // 2. Matn uzunligini tekshirish
    if (ctx.message.text && ctx.message.text.length < minLength) {
        ctx.reply(`⚠️ Iltimos, ma'lumotni to'liqroq yozing (kamida ${minLength} ta belgi bo'lishi kerak):`);
        return false;
    }
    
    return true;
}

const zayavkaWizard = new Scenes.WizardScene(
    'ZAYAVKA_SCENE',
    // 1-qadam: Toifa
    (ctx) => {
        ctx.reply('Assalomu alaykum! E\'lon berish uchun toifani tanlang:',
            Markup.keyboard([['📦 Yuk bor', '🚚 Mashina bor']]).resize().oneTime()
        );
        return ctx.wizard.next();
    },
    // 2-qadam: Yo'nalish
    (ctx) => {
        const status = checkInput(ctx, 5); // Kamida 5 ta belgi kutiladi
        if (status === 'leave') return;
        
        // Tayyor tugmalardan tashqari narsa yozsa qabul qilmaslik
        if (!status || (ctx.message.text !== '📦 Yuk bor' && ctx.message.text !== '🚚 Mashina bor')) {
            ctx.reply("⚠️ Iltimos, pastdagi tayyor tugmalardan birini tanlang!");
            return; // Shu qadamda qoladi va keyingisiga o'tkazmaydi
        }
        
        ctx.session.tur = ctx.message.text;
        ctx.reply('📍 Qayerdan - Qayerga boriladi?\n(Masalan: Toshkent - Samarqand)', Markup.removeKeyboard());
        return ctx.wizard.next();
    },
    // 3-qadam: Ma'lumot
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
    // 4-qadam: Sana va Narx
    (ctx) => {
        const status = checkInput(ctx, 5);
        if (status === 'leave') return;
        if (!status) return;

        ctx.session.malumot = ctx.message.text;
        ctx.reply('🗓 Sana va kutilayotgan narxni yozing:\n(Masalan: 25-oktabr, 1500$)');
        return ctx.wizard.next();
    },
    // 5-qadam: Telefon
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
    // 6-qadam: Guruhga e'lon joylash
    async (ctx) => {
        if (ctx.message.contact) {
            ctx.session.telefon = ctx.message.contact.phone_number;
        } else {
            const status = checkInput(ctx, 7); // Qo'lda yozilganda kamida 7 belgi (masalan: +998...)
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
            
            // Anti-Spam vaqtini o'rnatish
            cooldowns.set(ctx.from.id, Date.now());
        } catch (error) {
            ctx.reply('❌ Guruhga jo\'natishda xatolik yuz berdi.');
        }

        return ctx.scene.leave();
    }
);

const bot = new Telegraf(process.env.BOT_TOKEN);
const stage = new Scenes.Stage([zayavkaWizard]);

bot.use(session());
bot.use(stage.middleware());

bot.start(checkSubscription, (ctx) => {
    saveUser(ctx.from.id);

    const lastTime = cooldowns.get(ctx.from.id);
    if (lastTime && Date.now() - lastTime < COOLDOWN_TIME) {
        const qolganVaqt = Math.ceil((COOLDOWN_TIME - (Date.now() - lastTime)) / 60000);
        return ctx.reply(`⏳ <b>Anti-Spam tizimi:</b> Iltimos, keyingi e'lonni berish uchun ${qolganVaqt} daqiqa kuting.`, { parse_mode: 'HTML' });
    }

    ctx.scene.enter('ZAYAVKA_SCENE');
});

bot.action('check_sub', async (ctx) => {
    try {
        const member = await ctx.telegram.getChatMember(process.env.CHANNEL_ID, ctx.from.id);
        if (member.status === 'left' || member.status === 'kicked') {
            await ctx.answerCbQuery("⚠️ Hali kanalga a'zo bo'lmagansiz. Iltimos, avval kanalga qo'shiling!", { show_alert: true });
        } else {
            saveUser(ctx.from.id);
            const lastTime = cooldowns.get(ctx.from.id);
            if (lastTime && Date.now() - lastTime < COOLDOWN_TIME) {
                const qolganVaqt = Math.ceil((COOLDOWN_TIME - (Date.now() - lastTime)) / 60000);
                await ctx.answerCbQuery(`⏳ Keyingi e'lon uchun ${qolganVaqt} daqiqa kuting.`, { show_alert: true });
                return ctx.deleteMessage();
            }

            await ctx.answerCbQuery("✅ A'zo bo'lganingiz uchun rahmat!");
            await ctx.deleteMessage(); 
            ctx.scene.enter('ZAYAVKA_SCENE');
        }
    } catch (error) {
        await ctx.answerCbQuery("Xatolik yuz berdi. Bot kanalda adminligini tekshiring.");
    }
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
        } catch (error) {
            await ctx.answerCbQuery("Xatolik yuz berdi.");
        }
    } else {
        await ctx.answerCbQuery("⚠️ Bu e'lonni faqat uning egasi yopa oladi!", { show_alert: true });
    }
});

bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    const message = ctx.message.text.replace('/broadcast', '').trim();
    if (!message) return ctx.reply("⚠️ Xabar yozishni unutingiz! Masalan: /broadcast Hammaga salom!");

    const users = JSON.parse(fs.readFileSync(usersFile));
    let sentCount = 0;

    for (let userId of users) {
        try {
            await ctx.telegram.sendMessage(userId, `📢 <b>Humo Logistics xabarnomasi:</b>\n\n${message}`, { parse_mode: 'HTML' });
            sentCount++;
        } catch (e) {} 
    }
    ctx.reply(`✅ Xabar muvaffaqiyatli ${sentCount} ta foydalanuvchiga yuborildi!`);
});

bot.launch().then(() => {
    console.log('✅ Humo Logistics Dispatcher Bot to\'liq ishga tushdi!');
});

const http = require('http');
http.createServer((req, res) => res.end('Zayavka Bot is running')).listen(process.env.PORT || 8080);