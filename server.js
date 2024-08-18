import express from 'express';
import cors from 'cors';
import { Watchseries } from './sources/watchseriesx.js';
import { Vidsrc } from './sources/vidsrc.js';
import { Aniwave } from './sources/aniwave.js';
import { Myflixerz } from './sources/myflixerz.js';
import { FlixHQ } from './sources/flixhq.js';
import { VidsrcMe } from './sources/vidsrcme.js';

const app = express();
const port = 3000;

// 启用 CORS
app.use(cors());

// 错误处理函数
function error(id, message, error) {
    console.error(`[${id}] ${message}:`, error);
    return { error: message, details: error.message };
}

// 参数验证中间件
function validateParams(req, res, next) {
    const { source, type, id, season, episode } = req.query;
    if (!source) {
        return res.status(400).json({ error: 'Source parameter is required' });
    }
    if (type && !['movie', 'tv', 'search'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type parameter' });
    }
    if (type === 'tv' && (!season || !episode)) {
        return res.status(400).json({ error: 'Season and episode are required for TV shows' });
    }
    next();
}

// 源处理函数
const sourceHandlers = {
    vidsrc: async (type, id, season, episode) => {
        let result;
        if (type === 'movie') {
            result = await Vidsrc.movie(id);
        } else if (type === 'tv') {
            result = await Vidsrc.tv(id, parseInt(season), parseInt(episode));
        } else {
            result = [
                await Vidsrc.movie("385687"),
                await Vidsrc.tv("tt0944947", 1, 1),
                await Vidsrc.tv("tt1190634", 1, 1),
                await Vidsrc.tv("60059", 1, 1)
            ];
        }
        return result;
    },
    watchseries: async (type, id, season, episode) => {
        let result;
        if (type === 'movie') {
            result = await Watchseries.movie(id);
        } else if (type === 'tv') {
            result = await Watchseries.tv(id, parseInt(season), parseInt(episode));
        } else if (type === 'search') {
            result = await Watchseries.search(id);
        } else {
            const searchResults = await Watchseries.search("The big bang theory");
            result = [
                await Watchseries.tv("the-big-bang-theory-jyr9n", 1, 1),
                searchResults[0].type === 'tv' 
                    ? await Watchseries.tv(searchResults[0].id, 1, 2)
                    : await Watchseries.movie(searchResults[0].id),
                await Watchseries.movie("movie-vika-online-k3n6m")
            ];
        }
        return result;
    },
    flixhq: async (type, id, season, episode) => {
        let result;
        if (type === 'movie') {
            result = await FlixHQ.movie(id);
        } else if (type === 'tv') {
            result = await FlixHQ.tv(id, parseInt(season), parseInt(episode));
        } else {
            result = [
                await FlixHQ.movie("watch-the-pastor-111166"),
                await FlixHQ.tv("watch-the-big-bang-theory-39508", 1, 1)
            ];
        }
        return result;
    },
    myflixerz: async (type, id, season, episode) => {
        let result;
        if (type === 'movie') {
            result = await Myflixerz.movie(id);
        } else if (type === 'tv') {
            result = await Myflixerz.tv(id, parseInt(season), parseInt(episode), Myflixerz.SERVER_UPSTREAM);
        } else {
            result = [
                await Myflixerz.movie("watch-the-pastor-111166"),
                await Myflixerz.tv("the-big-bang-theory-39508.4857451", 1, 1, Myflixerz.SERVER_UPSTREAM)
            ];
        }
        return result;
    },
    vidsrcme: async (type, id, season, episode) => {
        let result;
        if (type === 'movie') {
            result = await VidsrcMe.movie(id);
        } else if (type === 'tv') {
            result = await VidsrcMe.tv(id, parseInt(season), parseInt(episode));
        } else {
            result = [
                await VidsrcMe.tv('tt1312171', 2, 3),
                await VidsrcMe.movie('tt1300854')
            ];
        }
        return result;
    },
    aniwave: async (type, id, season, episode) => {
        let result;
        if (type === 'movie') {
            result = await Aniwave.movie(id);
        } else if (type === 'tv') {
            result = await Aniwave.tv(id, parseInt(season));
        } else if (type === 'search') {
            result = await Aniwave.search(id);
        } else {
            const searchResults = await Aniwave.search("one piece");
            result = [
                await Aniwave.tv("one-piece.x3ln", 1),
                searchResults[0].type === 'tv'
                    ? await Aniwave.tv(searchResults[0].id, 1)
                    : await Aniwave.movie(searchResults[0].id)
            ];
        }
        return result;
    }
};

app.get('/video', validateParams, async (req, res) => {
    const { source, type, id, season, episode } = req.query;

    if (!sourceHandlers[source]) {
        return res.status(400).json({ error: 'Invalid source specified' });
    }

    try {
        const result = await sourceHandlers[source](type, id, season, episode);
        res.json({ source, type, result });
    } catch (e) {
        res.status(500).json(error(source, `${source} failed`, e));
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
