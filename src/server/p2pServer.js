const express = require('express');
const http = require('http');
const https = require('https');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const EventEmitter = require('events');
const DataManager = require('../utils/dataManager');

class P2PServer extends EventEmitter {
    constructor(port = 8888) {
        super();
        this.port = port;
        this.app = express();
        this.server = null;
        this.dataManager = new DataManager();
        this.peers = this.dataManager.peers;
        this.chatHistory = new Map();
        
        // 从保存的数据加载用户信息，如果没有则创建新的
        this.userInfo = this.dataManager.user || {
            id: this.generateId(),
            nickname: '我的昵称',
            avatar: 'fas fa-user',
            ip: this.getLocalIP(),
            port: port,
            version: '1.0.0'  // 添加版本信息
        };
        
        // 确保现有用户信息包含版本字段
        if (!this.userInfo.version) {
            this.userInfo.version = '1.0.0';
        }
        
        // 更新IP和端口
        this.userInfo.ip = this.getLocalIP();
        this.userInfo.port = port;
        
        // 保存用户信息
        this.dataManager.saveUser(this.userInfo);
        
        // 定期更新IP地址（每30秒检查一次）
        setInterval(() => {
            const newIP = this.getLocalIP();
            if (newIP !== this.userInfo.ip) {
                console.log(`IP地址已更新: ${this.userInfo.ip} -> ${newIP}`);
                this.userInfo.ip = newIP;
            }
        }, 30000);
        this.pollIntervals = new Map();
        this.setupRoutes();
        this.setupFileUpload();
    }

    getLocalIP() {
        const interfaces = os.networkInterfaces();
        
        // 优先查找以太网和WiFi接口
        const preferredNames = ['以太网', 'Ethernet', 'Wi-Fi', 'WLAN', 'eth0', 'wlan0'];
        
        for (const preferredName of preferredNames) {
            if (interfaces[preferredName]) {
                for (const iface of interfaces[preferredName]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        console.log(`使用网络接口 ${preferredName}: ${iface.address}`);
                        return iface.address;
                    }
                }
            }
        }
        
        // 如果没找到优先接口，查找所有非内部IPv4地址
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`使用网络接口 ${name}: ${iface.address}`);
                    return iface.address;
                }
            }
        }
        
        console.warn('未找到合适的网络接口，使用localhost');
        return '127.0.0.1';
    }

    httpRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            
            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: options.headers || {},
                timeout: options.timeout || 5000
            };

            const req = httpModule.request(requestOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const result = {
                            ok: res.statusCode >= 200 && res.statusCode < 300,
                            status: res.statusCode,
                            statusText: res.statusMessage,
                            json: () => Promise.resolve(JSON.parse(data)),
                            text: () => Promise.resolve(data)
                        };
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (options.body) {
                req.write(options.body);
            }
            
            req.end();
        });
    }

    generateId() {
        return Math.random().toString(36).substr(2, 9);
    }
    
    isValidIP(ip) {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip) || ip === 'localhost';
    }
    
    // 扫描同网段的8888端口
    async scanNetwork(baseIP) {
        console.log(`\n=== 开始扫描网段: ${baseIP} ===`);
        
        // 从baseIP中提取网段前缀
        const ipParts = baseIP.split('.');
        if (ipParts.length !== 4) {
            throw new Error('无效的IP地址格式');
        }
        
        const networkPrefix = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
        const results = [];
        const scanPromises = [];
        
        console.log(`扫描范围: ${networkPrefix}.1 - ${networkPrefix}.254`);
        console.log(`跳过本机IP: ${baseIP}`);
        console.log(`扫描配置: 批次大小=5, 超时=3秒, 批次间隔=100ms\n`);
        
        // 创建扫描任务，减少并发数量提高成功率
        const batchSize = 64; // 减少并发数量
        const delay = 10; // 每批次间隔100ms
        
        let batchCount = 0;
        const totalBatches = Math.ceil(254 / batchSize);
        
        for (let i = 1; i <= 254; i += batchSize) {
            batchCount++;
            const batch = [];
            const batchIPs = [];
            
            // 创建当前批次的扫描任务
            for (let j = i; j < Math.min(i + batchSize, 255); j++) {
                const ip = `${networkPrefix}.${j}`;
                if (ip === baseIP) continue; // 跳过自己的IP
                
                batchIPs.push(ip);
                batch.push(
                    this.checkPort(ip, 8888)
                        .then(isOpen => {
                            if (isOpen) {
                                console.log(`✓ 发现开放端口: ${ip}:8888`);
                                results.push(ip);
                            }
                        })
                        .catch(err => {
                            // 忽略错误，继续扫描
                            console.debug(`✗ 扫描 ${ip} 时出错:`, err.message);
                        })
                );
            }
            
            // 执行当前批次
            if (batch.length > 0) {
                console.log(`[批次 ${batchCount}/${totalBatches}] 扫描: ${batchIPs.join(', ')}`);
                await Promise.all(batch);
                console.log(`[批次 ${batchCount}/${totalBatches}] 完成`);
                
                // 批次间添加延迟
                if (i + batchSize < 254) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        console.log(`\n=== 扫描完成 ===`);
        console.log(`扫描网段: ${networkPrefix}.*`);
        console.log(`扫描总数: 254个IP地址`);
        console.log(`发现设备: ${results.length}个`);
        
        if (results.length > 0) {
            console.log(`\n发现的开放端口:`);
            results.forEach((ip, index) => {
                console.log(`  ${index + 1}. ${ip}:8888`);
            });
        } else {
            console.log(`\n未发现任何开放的8888端口`);
        }
        
        console.log(`===================\n`);
        return results;
    }
    
    // 检查指定IP和端口是否开放
    async checkPort(ip, port) {
        console.log(`🔍 检查端口: ${ip}:${port}`);
        try {
            // 设置较短的超时时间，避免扫描过慢
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000); // 增加超时时间到3秒
            
            // 首先尝试检查 /api/status 端点（我们的应用）
            try {
                const statusResponse = await fetch(`http://${ip}:${port}/api/status`, {
                    method: 'GET',
                    signal: controller.signal
                });
                
                if (statusResponse.ok) {
                    console.log(`✅ 发现LocalChater应用: ${ip}:${port}`);
                    clearTimeout(timeout);
                    return true;
                }
            } catch (statusError) {
                // /api/status 失败，尝试根路径
            }
            
            // 如果 /api/status 失败，尝试根路径检查是否有HTTP服务
            const rootResponse = await fetch(`http://${ip}:${port}/`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            // 只要能连接到HTTP服务就认为端口开放
            console.log(`🌐 发现HTTP服务: ${ip}:${port} (非LocalChater应用)`);
            return true;
            
        } catch (error) {
            console.log(`❌ 端口检查失败: ${ip}:${port} - ${error.message}`);
            return false;
        }
    }

    setupRoutes() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../../uploads')));

        // 连接请求
        this.app.post('/api/connect', (req, res) => {
            const { user } = req.body;
            if (user && user.id) {
                this.peers.set(user.id, {
                    ...user,
                    status: 'connected',
                    lastSeen: Date.now()
                });
                
                this.emit('peer-connected', user);
                
                res.json({
                    success: true,
                    user: this.userInfo
                });
            } else {
                res.status(400).json({ error: '无效的用户信息' });
            }
        });

        // 心跳检测
        this.app.post('/api/ping', (req, res) => {
            res.json({ pong: true, timestamp: Date.now() });
        });

        // 获取聊天记录
        this.app.get('/api/chat/:userId', (req, res) => {
            const userId = req.params.userId;
            const history = this.chatHistory.get(userId) || [];
            res.json(history);
        });

        // 接收消息
        this.app.post('/api/receive-message', (req, res) => {
            const { senderId, message } = req.body;
            
            const messageData = {
                id: this.generateId(),
                senderId: senderId,
                senderNickname: message.senderNickname,
                content: message.content,
                type: 'text',
                timestamp: Date.now()
            };
            
            this.addMessageToHistory(senderId, messageData);
            this.emit('message-received', senderId, messageData);
            
            res.json({ success: true });
        });

        // 接收文件
        this.app.post('/api/receive-file', (req, res) => {
            const { senderId, fileInfo } = req.body;
            
            const messageData = {
                id: this.generateId(),
                senderId: senderId,
                senderNickname: fileInfo.senderNickname,
                type: 'file',
                fileInfo: fileInfo,
                timestamp: Date.now()
            };
            
            this.addMessageToHistory(senderId, messageData);
            this.emit('file-received', senderId, messageData);
            
            res.json({ success: true });
        });

        // 文件下载
        this.app.get('/api/download/:fileId', (req, res) => {
            const fileId = req.params.fileId;
            const uploadsDir = path.join(__dirname, '../../uploads');
            
            // 查找文件
            const files = fs.readdirSync(uploadsDir);
            const file = files.find(f => f.startsWith(fileId));
            
            if (file) {
                const filePath = path.join(uploadsDir, file);
                res.download(filePath);
            } else {
                res.status(404).json({ error: '文件未找到' });
            }
        });

        // 获取用户信息
        this.app.get('/api/user', (req, res) => {
            res.json(this.userInfo);
        });

        // 更新用户信息
        this.app.post('/api/user', (req, res) => {
            Object.assign(this.userInfo, req.body);
            this.dataManager.saveUser(this.userInfo);
            res.json({ success: true, user: this.userInfo });
        });

        // 获取最近连接的好友
        this.app.get('/api/recent-peers', (req, res) => {
            const recentPeers = this.dataManager.getRecentPeers(10);
            res.json(recentPeers);
        });

        // 清理旧的好友记录
        this.app.delete('/api/peers/cleanup', (req, res) => {
            const removed = this.dataManager.clearOldPeers(30);
            res.json({ success: true, removed });
        });

        // 同步用户信息到所有连接的对等端
        this.app.post('/api/sync-user-info', async (req, res) => {
            try {
                await this.syncUserInfoToAllPeers();
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // 接收其他用户的信息更新
        this.app.post('/api/user-info-update', (req, res) => {
            try {
                const { userId, userInfo } = req.body;
                const peer = this.peers.get(userId);
                
                if (peer) {
                    // 更新对等端信息
                    Object.assign(peer, {
                        nickname: userInfo.nickname,
                        avatar: userInfo.avatar,
                        lastUpdated: Date.now()
                    });
                    
                    // 保存到数据管理器
                    this.dataManager.updatePeer(userId, peer);
                    
                    // 通知前端用户信息已更新
                    this.emit('peer-info-updated', userId, peer);
                }
                
                res.json({ success: true });
            } catch (error) {
                console.error('处理用户信息更新失败:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });
    }

    setupFileUpload() {
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const storage = multer.diskStorage({
            destination: uploadsDir,
            filename: (req, file, cb) => {
                const fileId = this.generateId();
                const ext = path.extname(file.originalname);
                cb(null, fileId + ext);
            }
        });

        const upload = multer({ storage });

        this.app.post('/api/upload', upload.single('file'), (req, res) => {
            if (!req.file) {
                return res.status(400).json({ error: '没有文件上传' });
            }

            const fileInfo = {
                id: path.parse(req.file.filename).name,
                originalName: req.file.originalname,
                size: req.file.size,
                uploadTime: Date.now(),
                downloadUrl: `http://${this.userInfo.ip}:${this.port}/api/download/${path.parse(req.file.filename).name}`
            };

            res.json({ success: true, fileInfo });
        });
    }

    async start() {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`P2P服务器启动在端口 ${this.port}`);
                resolve(true);
            });
            
            this.server.on('error', (error) => {
                console.error('服务器启动失败:', error);
                reject(error);
            });
        });
    }

    async stop() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('P2P服务器已停止');
                    this.server = null;
                    resolve();
                });
            });
        }
    }

    async connectToPeer(ip, port) {
        try {
            // 验证IP地址格式
            if (!this.isValidIP(ip)) {
                throw new Error('无效的IP地址格式');
            }
            
            // 验证端口范围
            if (port < 1 || port > 65535) {
                throw new Error('端口号必须在1-65535之间');
            }
            
            console.log(`尝试连接到 ${ip}:${port}`);
            
            const response = await this.httpRequest(`http://${ip}:${port}/api/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user: this.userInfo
                }),
                timeout: 10000  // 增加超时时间到10秒
            });

            if (response.ok) {
                const data = await response.json();
                const peerId = data.user.id;
                
                // 使用数据管理器添加或更新peer
                const peerData = {
                    ...data.user,
                    ip: ip,
                    port: port,
                    status: 'connected',
                    lastSeen: Date.now()
                };
                
                const peer = this.dataManager.addPeer(peerData);
                
                this.emit('peer-connected', peer);
                this.startPollingPeer(peer);
                
                console.log(`成功连接到 ${peer.nickname} (${ip}:${port})`);
                return true;
            } else {
                throw new Error(`连接被拒绝 (状态码: ${response.status})`);
            }
        } catch (error) {
            let errorMessage = '连接失败';
            if (error.message.includes('timeout')) {
                errorMessage = '连接超时，请检查对方是否在线或网络是否正常';
            } else if (error.message.includes('ECONNREFUSED')) {
                errorMessage = '连接被拒绝，请检查对方是否启动了应用';
            } else if (error.message.includes('ENOTFOUND')) {
                errorMessage = '找不到主机，请检查IP地址是否正确';
            } else if (error.message.includes('ENETUNREACH')) {
                errorMessage = '网络不可达，请检查网络连接';
            }
            
            console.error(`${errorMessage}:`, error.message);
            const finalError = new Error(errorMessage);
            finalError.originalError = error;
            throw finalError;
        }
    }

    startPollingPeer(peer) {
        if (this.pollIntervals.has(peer.id)) {
            clearInterval(this.pollIntervals.get(peer.id));
        }

        const interval = setInterval(async () => {
            try {
                const pingResponse = await this.httpRequest(`http://${peer.ip}:${peer.port}/api/ping`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        user: this.userInfo
                    }),
                    timeout: 3000
                });

                if (pingResponse.ok) {
                    peer.status = 'connected';
                    peer.lastSeen = Date.now();
                    
                    const chatResponse = await this.httpRequest(`http://${peer.ip}:${peer.port}/api/chat/${this.userInfo.id}`, {
                        timeout: 5000
                    });
                    
                    if (chatResponse.ok) {
                        const remoteHistory = await chatResponse.json();
                        this.syncChatHistory(peer.id, remoteHistory);
                    }
                } else {
                    throw new Error('Ping failed');
                }
            } catch (error) {
                console.log(`轮询 ${peer.nickname} 失败:`, error.message);
                peer.status = 'disconnected';
                
                // 更新数据管理器中的peer状态
                this.dataManager.updatePeer(peer.id, { status: 'disconnected', lastSeen: Date.now() });
                
                // 不删除peer，只更新状态并停止轮询
                if (Date.now() - peer.lastSeen > 30000) {
                    clearInterval(interval);
                    this.pollIntervals.delete(peer.id);
                    this.emit('peer-disconnected', peer.id);
                }
            }
        }, 5000);

        this.pollIntervals.set(peer.id, interval);
    }

    syncChatHistory(peerId, remoteHistory) {
        const localHistory = this.chatHistory.get(peerId) || [];
        const localMessageIds = new Set(localHistory.map(msg => msg.id));
        
        const newMessages = remoteHistory.filter(msg => 
            !localMessageIds.has(msg.id) && msg.senderId === peerId
        );
        
        if (newMessages.length > 0) {
            const updatedHistory = [...localHistory, ...newMessages]
                .sort((a, b) => a.timestamp - b.timestamp);
            this.chatHistory.set(peerId, updatedHistory);
            
            newMessages.forEach(msg => {
                this.emit('message-received', peerId, msg);
            });
        }
    }

    async sendMessage(peerId, message) {
        const peer = this.peers.get(peerId);
        if (!peer) throw new Error('对等节点未找到');

        try {
            const response = await this.httpRequest(`http://${peer.ip}:${peer.port}/api/receive-message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    senderId: this.userInfo.id,
                    message: {
                        senderNickname: this.userInfo.nickname,
                        content: message,
                        timestamp: Date.now()
                    }
                }),
                timeout: 10000
            });

            if (response.ok) {
                // 消息发送成功，不需要在服务器端添加历史记录
                // 历史记录由前端负责管理
                return true;
            } else {
                throw new Error('发送失败');
            }
        } catch (error) {
            console.error('发送消息失败:', error);
            throw error;
        }
    }

    async sendFile(peerId, filePath) {
        const peer = this.peers.get(peerId);
        if (!peer) throw new Error('对等节点未找到');

        try {
            const stats = fs.statSync(filePath);
            const fileName = path.basename(filePath);
            const fileId = this.generateId();
            
            const fileInfo = {
                id: fileId,
                originalName: fileName,
                size: stats.size,
                uploadTime: Date.now(),
                downloadUrl: `http://${this.userInfo.ip}:${this.port}/api/download/${fileId}`,
                senderNickname: this.userInfo.nickname
            };
            
            const uploadsDir = path.join(__dirname, '../../uploads');
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            
            const newFilePath = path.join(uploadsDir, fileId + path.extname(fileName));
            fs.copyFileSync(filePath, newFilePath);

            const response = await this.httpRequest(`http://${peer.ip}:${peer.port}/api/receive-file`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    senderId: this.userInfo.id,
                    fileInfo: fileInfo
                }),
                timeout: 10000
            });

            if (response.ok) {
                // 文件发送成功，不需要在服务器端添加历史记录
                // 历史记录由前端负责管理
                return true;
            } else {
                throw new Error('文件发送失败');
            }
        } catch (error) {
            console.error('发送文件失败:', error);
            throw error;
        }
    }

    addMessageToHistory(peerId, message) {
        if (!this.chatHistory.has(peerId)) {
            this.chatHistory.set(peerId, []);
        }
        const history = this.chatHistory.get(peerId);
        history.push(message);
        
        if (history.length > 1000) {
            history.splice(0, history.length - 1000);
        }
    }

    getConnectedPeers() {
        return Array.from(this.peers.values());
    }

    getStatus() {
        return {
            port: this.port,
            user: this.userInfo,
            peersCount: this.peers.size,
            isRunning: !!this.server
        };
    }

    async updateUserInfo(info) {
        try {
            console.log('更新用户信息:', info);
            Object.assign(this.userInfo, info);
            
            // 保存用户信息并检查是否成功
            const saveResult = this.dataManager.saveUser(this.userInfo);
            if (!saveResult) {
                throw new Error('保存用户信息到本地失败');
            }
            
            console.log('用户信息已更新:', this.userInfo);
            
            // 同步到所有连接的对等端
            await this.syncUserInfoToAllPeers();
            
            return { success: true, userInfo: this.userInfo };
        } catch (error) {
            console.error('更新用户信息失败:', error);
            return { success: false, error: error.message };
        }
    }

    getUserInfo() {
        return this.userInfo;
    }

    async syncUserInfoToAllPeers() {
        const promises = [];
        
        for (const [peerId, peer] of this.peers) {
            if (peer.status === 'connected') {
                const promise = this.syncUserInfoToPeer(peer).catch(error => {
                    console.error(`同步用户信息到 ${peer.nickname} 失败:`, error.message);
                });
                promises.push(promise);
            }
        }
        
        await Promise.allSettled(promises);
    }

    async syncUserInfoToPeer(peer) {
        try {
            const response = await this.httpRequest(`http://${peer.ip}:${peer.port}/api/user-info-update`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: this.userInfo.id,
                    userInfo: this.userInfo
                }),
                timeout: 5000
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            throw new Error(`同步用户信息失败: ${error.message}`);
        }
    }
}

module.exports = P2PServer;