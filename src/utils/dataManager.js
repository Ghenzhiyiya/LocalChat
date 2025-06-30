const fs = require('fs');
const path = require('path');
const os = require('os');

class DataManager {
    constructor() {
        // 使用Windows临时目录
        this.dataDir = path.join(os.tmpdir(), 'localchater');
        // 备用目录：如果临时目录不可用，使用用户目录
        if (!this.ensureDataDir()) {
            this.dataDir = path.join(os.homedir(), '.localchater');
            this.ensureDataDir();
        }
        this.configFile = path.join(this.dataDir, 'config.json');
        this.peersFile = path.join(this.dataDir, 'peers.json');
        this.userFile = path.join(this.dataDir, 'user.json');
        
        this.ensureDataDir();
        this.config = this.loadConfig();
        this.peers = this.loadPeers();
        this.user = this.loadUser();
    }

    generateId() {
        return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    ensureDataDir() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            // 测试写入权限
            const testFile = path.join(this.dataDir, '.test');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            return true;
        } catch (error) {
            console.warn('无法创建或写入数据目录:', this.dataDir, error.message);
            return false;
        }
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configFile)) {
                const data = fs.readFileSync(this.configFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('加载配置失败:', error);
        }
        
        // 默认配置
        return {
            autoConnect: true,
            rememberPeers: true,
            defaultPort: 8888,
            theme: 'light'
        };
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
        } catch (error) {
            console.error('保存配置失败:', error);
        }
    }

    loadPeers() {
        try {
            if (fs.existsSync(this.peersFile)) {
                const data = fs.readFileSync(this.peersFile, 'utf8');
                const peersArray = JSON.parse(data);
                const peersMap = new Map();
                
                // 去重处理，以IP:Port为唯一标识
                const uniquePeers = new Map();
                peersArray.forEach(peer => {
                    const key = `${peer.ip}:${peer.port}`;
                    if (!uniquePeers.has(key) || peer.lastSeen > uniquePeers.get(key).lastSeen) {
                        uniquePeers.set(key, peer);
                    }
                });
                
                uniquePeers.forEach(peer => {
                    peersMap.set(peer.id, peer);
                });
                
                return peersMap;
            }
        } catch (error) {
            console.error('加载好友列表失败:', error);
        }
        
        return new Map();
    }

    savePeers() {
        try {
            const peersArray = Array.from(this.peers.values());
            fs.writeFileSync(this.peersFile, JSON.stringify(peersArray, null, 2));
        } catch (error) {
            console.error('保存好友列表失败:', error);
        }
    }

    loadUser() {
        try {
            if (fs.existsSync(this.userFile)) {
                const data = fs.readFileSync(this.userFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('加载用户信息失败:', error, '文件路径:', this.userFile);
        }
        
        // 返回默认用户信息
        return {
            id: this.generateId ? this.generateId() : 'user_' + Date.now(),
            nickname: '用户' + Math.floor(Math.random() * 1000),
            avatar: 'fas fa-user',
            ip: '127.0.0.1',
            port: 8888
        };
    }

    saveUser(userInfo) {
        if (!userInfo) {
            console.error('保存用户信息失败: 用户信息为空');
            return false;
        }
        
        try {
            this.user = userInfo;
            // 确保目录存在
            this.ensureDataDir();
            // 保存用户信息
            fs.writeFileSync(this.userFile, JSON.stringify(userInfo, null, 2));
            console.log('用户信息已保存到:', this.userFile);
            return true;
        } catch (error) {
            console.error('保存用户信息失败:', error, '文件路径:', this.userFile);
            return false;
        }
    }

    addPeer(peer) {
        // 首先清理掉线的peer（超过5分钟未活动）
        this.cleanupOfflinePeers();
        
        // 检查是否已存在相同IP:Port的连接
        const existingPeerByAddress = Array.from(this.peers.values()).find(p => 
            p.ip === peer.ip && p.port === peer.port
        );
        
        // 检查是否已存在相同昵称的连接（可能是重复连接）
        const existingPeerByNickname = Array.from(this.peers.values()).find(p => 
            p.nickname === peer.nickname && p.nickname && 
            (p.ip !== peer.ip || p.port !== peer.port)
        );
        
        // 如果存在相同昵称但不同地址的peer，移除旧的
        if (existingPeerByNickname) {
            console.log(`检测到重复用户 ${peer.nickname}，移除旧连接 ${existingPeerByNickname.ip}:${existingPeerByNickname.port}`);
            this.peers.delete(existingPeerByNickname.id);
        }
        
        if (existingPeerByAddress) {
            // 更新现有连接的信息
            Object.assign(existingPeerByAddress, peer);
            existingPeerByAddress.lastSeen = Date.now();
            existingPeerByAddress.status = 'connected';
            this.peers.set(existingPeerByAddress.id, existingPeerByAddress);
            this.savePeers();
            return existingPeerByAddress;
        } else {
            // 添加新连接
            peer.lastSeen = Date.now();
            peer.status = 'connected';
            this.peers.set(peer.id, peer);
            this.savePeers();
            return peer;
        }
    }

    removePeer(peerId) {
        if (this.peers.has(peerId)) {
            this.peers.delete(peerId);
            this.savePeers();
            return true;
        }
        return false;
    }
    
    // 清理掉线的peer（超过5分钟未活动）
    cleanupOfflinePeers() {
        const now = Date.now();
        const offlineThreshold = 5 * 60 * 1000; // 5分钟
        
        const toRemove = [];
        for (const [id, peer] of this.peers) {
            if (peer.status !== 'connected' || (now - peer.lastSeen) > offlineThreshold) {
                toRemove.push(id);
            }
        }
        
        if (toRemove.length > 0) {
            console.log(`清理 ${toRemove.length} 个掉线的peer`);
            toRemove.forEach(id => {
                const peer = this.peers.get(id);
                console.log(`移除掉线peer: ${peer.nickname || '未知'} (${peer.ip}:${peer.port})`);
                this.peers.delete(id);
            });
            this.savePeers();
        }
    }

    // 手动清理所有掉线的peer
    forceCleanupOfflinePeers() {
        const connectedPeers = [];
        for (const [id, peer] of this.peers) {
            if (peer.status === 'connected') {
                connectedPeers.push(id);
            } else {
                console.log(`强制移除掉线peer: ${peer.nickname || '未知'} (${peer.ip}:${peer.port})`);
            }
        }
        
        // 清空所有peer，只保留连接状态的
        this.peers.clear();
        // 这里可以根据需要重新添加连接状态的peer
        this.savePeers();
        console.log(`强制清理完成，当前活跃连接: ${connectedPeers.length}`);
    }
    
    updatePeer(peerId, updates) {
        if (this.peers.has(peerId)) {
            const peer = this.peers.get(peerId);
            Object.assign(peer, updates);
            peer.lastSeen = Date.now();
            this.savePeers();
            return peer;
        }
        return null;
    }

    getRecentPeers(limit = 10) {
        return Array.from(this.peers.values())
            .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
            .slice(0, limit);
    }

    clearOldPeers(daysOld = 30) {
        const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
        let removed = 0;
        
        for (const [peerId, peer] of this.peers) {
            if ((peer.lastSeen || 0) < cutoffTime) {
                this.peers.delete(peerId);
                removed++;
            }
        }
        
        if (removed > 0) {
            this.savePeers();
        }
        
        return removed;
    }
}

module.exports = DataManager;