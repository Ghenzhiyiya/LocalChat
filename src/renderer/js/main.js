const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

class P2PChater {
    constructor() {
        this.currentPeer = null;
        this.localUser = {
            id: null,
            nickname: '用户' + Math.floor(Math.random() * 1000),
            avatar: 'fas fa-user',
            ip: '127.0.0.1',
            port: 8888
        };
        this.peers = new Map();
        this.chatHistory = new Map();
        this.pollIntervals = new Map();
        this.serverStatus = {
            running: false,
            port: 8888
        };
        this.recentPeers = [];
        this.ipcSetup = false; // 防止重复绑定IPC事件监听器
        
        // 加载进度管理
        this.loadingManager = {
            totalSteps: 5,
            currentStep: 0,
            progressBar: null,
            detailsElement: null,
            overlay: null
        };
        
        this.init();
    }

    async init() {
        try {
            console.log('开始初始化应用...');
            
            // 初始化加载管理器
            this.initLoadingManager();
            
            // 设置初始化超时
            const initTimeout = setTimeout(() => {
                console.error('初始化超时，可能存在阻塞操作');
                this.handleInitTimeout();
            }, 15000); // 15秒超时
            
            // 分步骤初始化，添加错误处理
            await this.safeAsyncOperationWithProgress('setupUI', () => this.setupUI(), '初始化界面...');
            await this.safeAsyncOperationWithProgress('getLocalIP', () => this.getLocalIP(), '获取网络信息...');
            await this.safeAsyncOperationWithProgress('loadUserInfo', () => this.loadUserInfo(), '加载用户信息...');
            await this.safeAsyncOperationWithProgress('loadChatHistory', () => this.loadChatHistoryFromFile(), '加载聊天记录...');
            await this.safeAsyncOperationWithProgress('startServer', () => this.startServer(), '启动P2P服务器...');
            
            // 同步操作
            this.updateLoadingProgress('设置事件监听器...');
            this.setupEventListeners();
            this.setupIPC();
            
            clearTimeout(initTimeout);
            console.log('应用初始化完成');
            
            // 隐藏加载界面
            this.hideLoadingOverlay();
            
            // 延迟加载非关键功能
            this.scheduleDelayedOperations();
            
            // 启动心跳检测
            this.startHeartbeat();
            
        } catch (error) {
            console.error('初始化失败:', error);
            this.handleInitError(error);
        }
    }
    
    // 启动心跳检测
    startHeartbeat() {
        // 每30秒检查一次应用状态
        this.heartbeatInterval = setInterval(() => {
            this.performHealthCheck();
        }, 30000);
        
        console.log('心跳检测已启动');
    }
    
    // 执行健康检查
    performHealthCheck() {
        try {
            // 检查关键元素是否存在
            const criticalElements = [
                'user-nickname',
                'chat-container',
                'peer-list'
            ];
            
            let healthScore = 0;
            criticalElements.forEach(id => {
                if (document.getElementById(id)) {
                    healthScore++;
                }
            });
            
            const healthPercentage = (healthScore / criticalElements.length) * 100;
            
            if (healthPercentage < 50) {
                console.warn(`应用健康度较低: ${healthPercentage}%`);
                this.handleLowHealth();
            } else {
                console.log(`应用健康检查通过: ${healthPercentage}%`);
            }
            
        } catch (error) {
            console.error('健康检查失败:', error);
        }
    }
    
    // 处理低健康度情况
    handleLowHealth() {
        console.warn('检测到应用可能存在问题，尝试恢复...');
        // 可以在这里添加恢复逻辑，比如重新初始化某些组件
    }
    
    // 停止心跳检测
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            console.log('心跳检测已停止');
        }
    }
    
    // 初始化加载管理器
    initLoadingManager() {
        this.loadingManager.progressBar = document.getElementById('progress-bar');
        this.loadingManager.detailsElement = document.getElementById('loading-details');
        this.loadingManager.overlay = document.getElementById('loading-overlay');
        this.loadingManager.currentStep = 0;
        
        if (this.loadingManager.progressBar) {
            this.loadingManager.progressBar.style.width = '0%';
        }
    }
    
    // 更新加载进度
    updateLoadingProgress(message) {
        if (this.loadingManager.detailsElement) {
            this.loadingManager.detailsElement.textContent = message;
        }
        
        this.loadingManager.currentStep++;
        const progress = (this.loadingManager.currentStep / this.loadingManager.totalSteps) * 100;
        
        if (this.loadingManager.progressBar) {
            this.loadingManager.progressBar.style.width = `${Math.min(progress, 100)}%`;
        }
        
        console.log(`加载进度: ${Math.round(progress)}% - ${message}`);
    }
    
    // 隐藏加载界面
    hideLoadingOverlay() {
        if (this.loadingManager.overlay) {
            this.loadingManager.overlay.classList.add('hidden');
            setTimeout(() => {
                this.loadingManager.overlay.style.display = 'none';
            }, 500);
        }
    }
    
    // 带进度的安全异步操作包装器
    async safeAsyncOperationWithProgress(operationName, operation, progressMessage, timeout = 5000) {
        this.updateLoadingProgress(progressMessage);
        return this.safeAsyncOperation(operationName, operation, timeout);
    }
    
    // 安全的异步操作包装器
    async safeAsyncOperation(operationName, operation, timeout = 5000) {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`${operationName} 操作超时`));
            }, timeout);
            
            try {
                const result = await operation();
                clearTimeout(timer);
                console.log(`${operationName} 完成`);
                resolve(result);
            } catch (error) {
                clearTimeout(timer);
                console.error(`${operationName} 失败:`, error);
                reject(error);
            }
        });
    }
    
    // 处理初始化超时
    handleInitTimeout() {
        console.warn('初始化超时，尝试恢复...');
        this.hideLoadingOverlay();
        this.showErrorMessage('应用初始化超时，某些功能可能不可用');
        // 尝试基本功能
        this.setupBasicFunctionality();
    }
    
    // 处理初始化错误
    handleInitError(error) {
        console.error('初始化错误:', error);
        this.hideLoadingOverlay();
        this.showErrorMessage(`应用初始化失败: ${error.message}`);
        // 尝试基本功能
        this.setupBasicFunctionality();
    }
    
    // 延迟操作调度
    scheduleDelayedOperations() {
        // 使用 requestIdleCallback 或 setTimeout 来避免阻塞
        if (window.requestIdleCallback) {
            requestIdleCallback(() => {
                this.loadDelayedFeatures();
            });
        } else {
            setTimeout(() => {
                this.loadDelayedFeatures();
            }, 1000);
        }
    }
    
    // 加载延迟功能
    async loadDelayedFeatures() {
        try {
            console.log('开始加载延迟功能...');
            
            await this.safeAsyncOperation('loadRecentPeers', () => this.loadRecentPeers(), 3000);
            await this.safeAsyncOperation('loadHistoricalFriends', () => this.loadHistoricalFriends(), 3000);
            
            // 再次延迟自动连接
            setTimeout(() => {
                this.safeAsyncOperation('autoConnect', () => this.autoConnectOnStartup(), 5000)
                    .catch(error => console.warn('自动连接失败:', error));
            }, 2000);
            
            console.log('延迟功能加载完成');
        } catch (error) {
            console.warn('延迟功能加载失败:', error);
        }
    }
    
    // 设置基本功能（错误恢复时使用）
    setupBasicFunctionality() {
        try {
            this.setupEventListeners();
            // 移除重复的setupIPC调用，避免事件监听器重复绑定
            console.log('基本功能已设置');
        } catch (error) {
            console.error('设置基本功能失败:', error);
        }
    }
    
    // 显示错误消息
    showErrorMessage(message) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff4444;
            color: white;
            padding: 10px;
            border-radius: 5px;
            z-index: 10000;
            max-width: 300px;
        `;
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }

    async setupUI() {
        // 标题栏按钮
        document.getElementById('minimize-btn').addEventListener('click', () => {
            ipcRenderer.invoke('minimize-window');
        });

        document.getElementById('maximize-btn').addEventListener('click', () => {
            ipcRenderer.invoke('maximize-window');
        });

        document.getElementById('close-btn').addEventListener('click', () => {
            ipcRenderer.invoke('close-window');
        });

        // 用户操作按钮
        document.getElementById('edit-nickname-btn').addEventListener('click', () => {
            this.showNicknameModal();
        });

        document.getElementById('set-avatar-btn').addEventListener('click', () => {
            this.showAvatarModal();
        });

        document.getElementById('server-settings-btn').addEventListener('click', () => {
            this.showServerModal();
        });

        document.getElementById('user-avatar').addEventListener('click', () => {
            this.showAvatarModal();
        });

        // 添加好友
        document.getElementById('add-friend-btn').addEventListener('click', () => {
            this.showAddFriendModal();
        });

        document.getElementById('welcome-add-friend').addEventListener('click', () => {
            this.showAddFriendModal();
        });

        // 聊天操作
        document.getElementById('send-file-btn').addEventListener('click', () => {
            this.selectAndSendFile();
        });

        document.getElementById('clear-chat-btn').addEventListener('click', () => {
            this.clearChat();
        });

        document.getElementById('file-btn').addEventListener('click', () => {
            this.selectAndSendFile();
        });

        document.getElementById('send-btn').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('message-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        document.getElementById('message-input').addEventListener('input', () => {
            this.updateSendButton();
            this.autoResizeTextarea();
        });

        document.getElementById('message-input').addEventListener('keyup', () => {
            this.autoResizeTextarea();
        });

        // 模态框事件
        this.setupModalEvents();
    }

    setupModalEvents() {
        // 添加好友模态框
        this.setupModal('add-friend-modal', 'close-add-friend-modal', 'cancel-add-friend');
        document.getElementById('confirm-add-friend').addEventListener('click', () => {
            this.connectToPeer();
        });

        // 昵称模态框
        this.setupModal('nickname-modal', 'close-nickname-modal', 'cancel-nickname');
        document.getElementById('confirm-nickname').addEventListener('click', () => {
            this.updateNickname();
        });
        document.getElementById('nickname-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.updateNickname();
            }
        });

        // 头像模态框
        this.setupModal('avatar-modal', 'close-avatar-modal');
        document.querySelectorAll('.avatar-option').forEach(option => {
            option.addEventListener('click', () => {
                this.selectAvatar(option.dataset.icon);
            });
        });

        // 服务器设置模态框
        this.setupModal('server-modal', 'close-server-modal');
        document.getElementById('restart-server-btn').addEventListener('click', () => {
            this.restartServer();
        });
        document.getElementById('save-server-settings').addEventListener('click', () => {
            this.saveServerSettings();
        });
    }

    setupModal(modalId, closeId, cancelId = null) {
        const modal = document.getElementById(modalId);
        const closeBtn = document.getElementById(closeId);
        const cancelBtn = cancelId ? document.getElementById(cancelId) : null;

        const hideModal = () => {
            modal.classList.remove('show');
        };

        closeBtn.addEventListener('click', hideModal);
        if (cancelBtn) cancelBtn.addEventListener('click', hideModal);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal();
        });
    }

    async loadRecentPeers() {
        try {
            // 首先尝试使用本地用户的IP和端口
            const response = await fetch(`http://${this.localUser.ip}:${this.localUser.port}/api/recent-peers`);
            if (response.ok) {
                this.recentPeers = await response.json();
                console.log('加载到最近连接:', this.recentPeers);
                this.updateAddFriendDialog();
                return;
            }
        } catch (error) {
            console.log('使用本地IP加载最近连接失败，尝试localhost:', error.message);
        }
        
        try {
            // 如果失败，回退到localhost
            const fallbackResponse = await fetch('http://localhost:8888/api/recent-peers');
            if (fallbackResponse.ok) {
                this.recentPeers = await fallbackResponse.json();
                console.log('使用localhost加载到最近连接:', this.recentPeers);
                this.updateAddFriendDialog();
            }
        } catch (error) {
            console.error('加载最近连接失败:', error);
        }
    }

    async loadHistoricalFriends() {
        try {
            // 从最近连接中加载所有历史好友到左侧列表
            if (this.recentPeers && this.recentPeers.length > 0) {
                console.log('正在加载历史好友到左侧列表...');
                
                for (const peer of this.recentPeers) {
                    // 检查是否已经在好友列表中
                    if (!this.peers.has(peer.id)) {
                        // 添加到好友列表，默认状态为离线
                        this.peers.set(peer.id, {
                            id: peer.id,
                            nickname: peer.nickname || '未知用户',
                            avatar: peer.avatar || 'fas fa-user',
                            ip: peer.ip,
                            port: peer.port || 8888,
                            status: 'offline' // 默认离线状态
                        });
                    }
                }
                
                // 更新好友列表显示
                this.updateFriendsList();
                console.log(`已加载 ${this.recentPeers.length} 个历史好友到左侧列表`);
                
                // 尝试检测在线状态
                this.checkFriendsOnlineStatus();
            }
        } catch (error) {
            console.error('加载历史好友失败:', error);
        }
    }

    async checkFriendsOnlineStatus() {
        console.log('正在检测好友在线状态...');
        
        for (const [peerId, peer] of this.peers) {
            try {
                // 尝试ping每个好友来检测在线状态
                const response = await fetch(`http://${peer.ip}:${peer.port}/api/ping`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        user: this.localUser
                    }),
                    signal: AbortSignal.timeout(3000)
                });
                
                if (response.ok) {
                    peer.status = 'connected';
                    console.log(`好友 ${peer.nickname} 在线`);
                } else {
                    peer.status = 'offline';
                }
            } catch (error) {
                peer.status = 'offline';
            }
        }
        
        // 更新显示
        this.updateFriendsList();
    }

    updateAddFriendDialog() {
        const recentIpsDatalist = document.getElementById('recent-ips');
        
        // 只更新datalist用于IP地址自动完成
        if (recentIpsDatalist && this.recentPeers && this.recentPeers.length > 0) {
            recentIpsDatalist.innerHTML = this.recentPeers.map(peer => 
                `<option value="${peer.ip}">${peer.nickname || '未知用户'} (${peer.ip})</option>`
            ).join('');
        }
    }

    formatTime(timestamp) {
        if (!timestamp) return '未知时间';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
        
        return date.toLocaleDateString();
    }

    handlePeerInfoUpdate(peerId, peerInfo) {
        const peer = this.peers.get(peerId);
        if (peer) {
            // 更新本地peer信息
            Object.assign(peer, peerInfo);
            
            // 更新好友列表显示
            this.updateFriendsList();
            
            // 如果是当前聊天的用户，更新聊天头部
            if (this.currentPeer && this.currentPeer.id === peerId) {
                document.querySelector('.chat-avatar').innerHTML = `<i class="${peer.avatar || 'fas fa-user'}"></i>`;
                document.querySelector('.chat-user-name').textContent = peer.nickname;
            }
            
            this.showNotification('好友信息更新', `${peer.nickname} 更新了个人信息`, 'info');
        }
    }

    async updateUserInfo(userInfo) {
        try {
            console.log('前端发送用户信息更新请求:', userInfo);
            const result = await ipcRenderer.invoke('update-user-info', userInfo);
            
            if (result && result.success) {
                Object.assign(this.localUser, result.userInfo);
                
                // 更新界面显示
                document.getElementById('user-nickname').textContent = this.localUser.nickname;
                document.querySelector('.user-avatar').innerHTML = `<i class="${this.localUser.avatar}"></i>`;
                
                this.showNotification('信息更新', '个人信息已更新并同步到所有好友', 'success');
                console.log('用户信息更新成功:', this.localUser);
            } else {
                const errorMsg = result ? result.error : '未知错误';
                console.error('更新用户信息失败:', errorMsg);
                this.showNotification('更新失败', `无法更新个人信息: ${errorMsg}`, 'error');
            }
        } catch (error) {
            console.error('更新用户信息异常:', error);
            this.showNotification('更新失败', `无法更新个人信息: ${error.message}`, 'error');
        }
    }

    setupEventListeners() {
        // 监听窗口关闭事件
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
        
        // 自动连接按钮
        document.getElementById('auto-connect-btn').addEventListener('click', () => {
            this.autoConnectToFriends();
        });
        
        // 清理重复IP按钮
        document.getElementById('cleanup-peers-btn').addEventListener('click', async () => {
            try {
                const cleanupBtn = document.getElementById('cleanup-peers-btn');
                cleanupBtn.disabled = true;
                cleanupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 清理中...';
                
                // 调用主进程清理掉线的peer
                const success = await ipcRenderer.invoke('cleanup-offline-peers');
                
                if (success) {
                    this.showNotification('清理完成', '已清理掉线和重复的IP地址', 'success');
                    // 刷新好友列表显示
                    this.updatePeerList();
                } else {
                    this.showNotification('清理失败', '无法清理IP地址，请稍后重试', 'error');
                }
            } catch (error) {
                console.error('清理重复IP时出错:', error);
                this.showNotification('清理失败', '清理过程中发生错误', 'error');
            } finally {
                const cleanupBtn = document.getElementById('cleanup-peers-btn');
                cleanupBtn.disabled = false;
                cleanupBtn.innerHTML = '<i class="fas fa-broom"></i> 清理重复IP';
            }
        });
        
        // 网段扫描按钮
        document.getElementById('scan-network-btn').addEventListener('click', async () => {
            try {
                const scanBtn = document.getElementById('scan-network-btn');
                scanBtn.disabled = true;
                scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 扫描中...';
                
                // 获取本地IP作为扫描基准
                const status = await ipcRenderer.invoke('get-server-status');
                if (!status || !status.user || !status.user.ip) {
                    this.showNotification('扫描失败', '无法获取本地IP地址', 'error');
                    return;
                }
                
                const baseIP = status.user.ip;
                this.showNotification('网段扫描', `开始扫描 ${baseIP.split('.').slice(0, 3).join('.')}.* 网段...`, 'info');
                
                // 调用主进程进行网段扫描
                const discoveredIPs = await ipcRenderer.invoke('scan-network', baseIP);
                
                if (discoveredIPs.length === 0) {
                    this.showNotification('扫描完成', '未发现其他开放8888端口的设备', 'info');
                    return;
                }
                
                this.showNotification('发现设备', `发现 ${discoveredIPs.length} 个设备，开始尝试连接...`, 'success');
                
                // 尝试连接发现的设备
                let connectedCount = 0;
                for (const ip of discoveredIPs) {
                    try {
                        scanBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 连接 ${ip}...`;
                        const success = await ipcRenderer.invoke('connect-to-peer', ip, 8888);
                        if (success) {
                            connectedCount++;
                            console.log(`成功连接到 ${ip}:8888`);
                        }
                        // 添加延迟避免过快连接
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (error) {
                        console.error(`连接 ${ip} 时出错:`, error);
                    }
                }
                
                const message = `网段扫描完成！发现 ${discoveredIPs.length} 个设备，成功连接 ${connectedCount} 个`;
                this.showNotification('扫描完成', message, connectedCount > 0 ? 'success' : 'info');
                
            } catch (error) {
                console.error('网段扫描时出错:', error);
                this.showNotification('扫描失败', '网段扫描过程中发生错误', 'error');
            } finally {
                const scanBtn = document.getElementById('scan-network-btn');
                scanBtn.disabled = false;
                scanBtn.innerHTML = '<i class="fas fa-search"></i> 扫描网段';
            }
        });
        
        // 初始化用户昵称显示
        this.updateUserDisplay();
    }

    setupIPC() {
        // 自动移除已存在的事件监听器，防止重复绑定
        const events = ['peer-connected', 'peer-disconnected', 'message-received', 'file-received', 'server-error', 'show-add-friend-dialog', 'file-selected', 'edit-nickname', 'edit-avatar', 'server-settings', 'peer-info-updated'];
        events.forEach(eventName => {
            ipcRenderer.removeAllListeners(eventName);
        });

        // 监听来自主进程的事件
        ipcRenderer.on('peer-connected', (event, peer) => {
            this.onPeerConnected(peer);
        });

        ipcRenderer.on('peer-disconnected', (event, peerId) => {
            this.onPeerDisconnected(peerId);
        });

        ipcRenderer.on('message-received', (event, peerId, message) => {
            this.onMessageReceived(peerId, message);
        });

        ipcRenderer.on('file-received', (event, peerId, fileInfo) => {
            this.onFileReceived(peerId, fileInfo);
        });

        ipcRenderer.on('server-error', (event, error) => {
            this.showNotification('服务器错误', error, 'error');
        });

        ipcRenderer.on('show-add-friend-dialog', () => {
            this.showAddFriendModal();
        });

        ipcRenderer.on('file-selected', (event, filePath) => {
            this.sendFile(filePath);
        });

        ipcRenderer.on('edit-nickname', () => {
            this.showNicknameModal();
        });

        ipcRenderer.on('edit-avatar', () => {
            this.showAvatarModal();
        });

        ipcRenderer.on('server-settings', () => {
            this.showServerModal();
        });

        // 监听用户信息更新事件
        ipcRenderer.on('peer-info-updated', (event, peerId, peerInfo) => {
            this.handlePeerInfoUpdate(peerId, peerInfo);
        });
    }

    async getLocalIP() {
        try {
            this.localUser.ip = await ipcRenderer.invoke('get-local-ip');
            document.getElementById('user-ip').textContent = this.localUser.ip;
        } catch (error) {
            console.error('获取本地IP失败:', error);
            this.localUser.ip = '127.0.0.1';
        }
    }

    async loadUserInfo() {
        try {
            // 从主进程获取用户信息
            const userInfo = await ipcRenderer.invoke('get-user-info');
            if (userInfo) {
                Object.assign(this.localUser, userInfo);
                // 更新界面显示
        const userNameEl = document.getElementById('user-nickname');
                const userAvatarEl = document.querySelector('.user-avatar');
                
                if (userNameEl) {
                    userNameEl.textContent = this.localUser.nickname;
                }
                if (userAvatarEl) {
                    userAvatarEl.innerHTML = `<i class="${this.localUser.avatar}"></i>`;
                }
                
                console.log('加载用户信息成功:', this.localUser);
                
                // 确保用户信息显示正确
                this.updateUserDisplay();
            } else {
                console.log('未获取到用户信息，使用默认值');
                this.updateUserDisplay();
            }
        } catch (error) {
            console.error('加载用户信息失败:', error);
            // 即使失败也要更新显示
            this.updateUserDisplay();
        }
    }

    updateUserDisplay() {
        // 确保用户信息在界面上正确显示
        const userNameEl = document.getElementById('user-nickname');
        const userAvatarEl = document.querySelector('.user-avatar');
        const userIpEl = document.getElementById('user-ip');
        const serverPortEl = document.getElementById('server-port');
        
        if (userNameEl) {
            userNameEl.textContent = this.localUser.nickname;
        }
        if (userAvatarEl) {
            userAvatarEl.innerHTML = `<i class="${this.localUser.avatar}"></i>`;
        }
        if (userIpEl) {
            userIpEl.textContent = this.localUser.ip;
        }
        if (serverPortEl) {
            serverPortEl.textContent = `:${this.localUser.port}`;
        }
        
        console.log('用户显示信息已更新:', {
            nickname: this.localUser.nickname,
            avatar: this.localUser.avatar,
            ip: this.localUser.ip,
            port: this.localUser.port
        });
    }

    async startServer() {
        try {
            const success = await ipcRenderer.invoke('start-server', this.localUser.port);
            if (success) {
                this.serverStatus.running = true;
                document.getElementById('server-port').textContent = `:${this.localUser.port}`;
                this.showNotification('服务器启动', `P2P服务器已在端口 ${this.localUser.port} 启动`, 'success');
                
                // 获取服务器状态
                const status = await ipcRenderer.invoke('get-server-status');
                if (status && status.user) {
                    this.localUser.id = status.user.id;
                }
            } else {
                this.showNotification('启动失败', '无法启动P2P服务器', 'error');
            }
        } catch (error) {
            console.error('启动服务器失败:', error);
            this.showNotification('启动失败', error.message, 'error');
        }
    }

    async restartServer() {
        try {
            await ipcRenderer.invoke('stop-server');
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.startServer();
            this.hideModal('server-modal');
        } catch (error) {
            console.error('重启服务器失败:', error);
            this.showNotification('重启失败', error.message, 'error');
        }
    }

    async saveServerSettings() {
        const newPort = parseInt(document.getElementById('server-port-input').value);
        if (newPort && newPort !== this.localUser.port) {
            this.localUser.port = newPort;
            await this.restartServer();
        } else {
            this.hideModal('server-modal');
        }
    }

    async showAddFriendModal() {
        // 更新本地信息显示
        document.getElementById('local-ip-display').textContent = this.localUser.ip || '获取中...';
        document.getElementById('local-port-display').textContent = this.localUser.port;
        
        // 重新加载最近连接的好友列表
        await this.loadRecentPeers();
        
        document.getElementById('add-friend-modal').classList.add('show');
        document.getElementById('friend-ip').focus();
    }

    showNicknameModal() {
        document.getElementById('nickname-input').value = this.localUser.nickname;
        document.getElementById('nickname-modal').classList.add('show');
        document.getElementById('nickname-input').focus();
    }

    showAvatarModal() {
        document.getElementById('avatar-modal').classList.add('show');
        // 高亮当前头像
        document.querySelectorAll('.avatar-option').forEach(option => {
            option.classList.toggle('selected', option.dataset.icon === this.localUser.avatar);
        });
    }

    showServerModal() {
        document.getElementById('server-port-input').value = this.localUser.port;
        document.getElementById('server-status').textContent = this.serverStatus.running ? '运行中' : '已停止';
        document.getElementById('connection-count').textContent = this.peers.size;
        document.getElementById('server-modal').classList.add('show');
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
    }

    async connectToPeer() {
        const ip = document.getElementById('friend-ip').value.trim();
        const port = parseInt(document.getElementById('friend-port').value);
        const statusEl = document.getElementById('connection-status');

        if (!ip || !port) {
            this.showConnectionStatus('请输入有效的IP地址和端口', 'error');
            return;
        }

        this.showConnectionStatus('正在连接...', 'loading');

        try {
            const success = await ipcRenderer.invoke('connect-to-peer', ip, port);
            if (success) {
                this.showConnectionStatus('连接成功！', 'success');
                setTimeout(() => {
                    this.hideModal('add-friend-modal');
                    statusEl.style.display = 'none';
                }, 1500);
            } else {
                this.showConnectionStatus('连接失败，请检查IP和端口是否正确', 'error');
            }
        } catch (error) {
            console.error('连接失败:', error);
            this.showConnectionStatus('连接失败: ' + error.message, 'error');
        }
    }

    showConnectionStatus(message, type) {
        const statusEl = document.getElementById('connection-status');
        statusEl.textContent = message;
        statusEl.className = `connection-status ${type}`;
    }

    async updateNickname() {
        const newNickname = document.getElementById('nickname-input').value.trim();
        if (!newNickname) {
            this.showNotification('错误', '昵称不能为空', 'error');
            return;
        }

        await this.updateUserInfo({ nickname: newNickname });
        document.getElementById('user-nickname').textContent = newNickname;
        this.hideModal('nickname-modal');
    }

    async selectAvatar(iconClass) {
        await this.updateUserInfo({ avatar: iconClass });
        
        // 更新UI
        const avatarEl = document.getElementById('user-avatar');
        avatarEl.innerHTML = `<i class="${iconClass}"></i>`;
        
        this.hideModal('avatar-modal');
    }

    onPeerConnected(peer) {
        this.peers.set(peer.id, peer);
        this.updateFriendsList();
        this.showNotification('好友上线', `${peer.nickname} 已连接`, 'info');
    }

    onPeerDisconnected(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            // 不删除peer，只更新状态为离线
            peer.status = 'disconnected';
            this.updateFriendsList();
            this.showNotification('好友离线', `${peer.nickname} 已断开连接`, 'info');
            
            // 如果当前正在与该用户聊天，更新状态
            if (this.currentPeer && this.currentPeer.id === peerId) {
                document.querySelector('.chat-user-status').textContent = '离线';
            }
        }
        
        // 停止轮询
        if (this.pollIntervals.has(peerId)) {
            clearInterval(this.pollIntervals.get(peerId));
            this.pollIntervals.delete(peerId);
        }
    }

    onMessageReceived(peerId, message) {
        // 检查消息是否已存在，避免重复添加
        const localHistory = this.chatHistory.get(peerId) || [];
        const messageExists = localHistory.some(msg => msg.id === message.id);
        
        if (!messageExists) {
            this.addMessageToHistory(peerId, message);
            
            if (this.currentPeer && this.currentPeer.id === peerId) {
                this.displayMessage(message);
            } else {
                const peer = this.peers.get(peerId);
                const senderName = peer ? peer.nickname : '未知用户';
                this.showNotification('新消息', `${senderName}: ${message.content}`, 'info');
            }
        }
    }

    onFileReceived(peerId, fileInfo) {
        // 检查消息是否已存在，避免重复添加
        const localHistory = this.chatHistory.get(peerId) || [];
        const messageExists = localHistory.some(msg => msg.id === fileInfo.id);
        
        if (!messageExists) {
            this.addMessageToHistory(peerId, fileInfo);
            
            if (this.currentPeer && this.currentPeer.id === peerId) {
                this.displayMessage(fileInfo);
            } else {
                const peer = this.peers.get(peerId);
                const senderName = peer ? peer.nickname : '未知用户';
                this.showNotification('文件接收', `${senderName} 发送了文件: ${fileInfo.fileInfo.originalName}`, 'info');
            }
        }
    }

    updateFriendsList() {
        const friendsList = document.getElementById('friends-list');
        const friendsCount = document.getElementById('friends-count');
        
        friendsCount.textContent = this.peers.size;
        
        if (this.peers.size === 0) {
            friendsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>暂无好友</p>
                    <p>点击上方按钮添加好友</p>
                </div>
            `;
            return;
        }
        
        friendsList.innerHTML = '';
        
        for (const [peerId, peer] of this.peers) {
            const friendItem = document.createElement('div');
            friendItem.className = 'friend-item';
            if (this.currentPeer && this.currentPeer.id === peerId) {
                friendItem.classList.add('active');
            }
            
            friendItem.innerHTML = `
                <div class="friend-avatar">
                    <i class="${peer.avatar || 'fas fa-user'}"></i>
                </div>
                <div class="friend-info">
                    <div class="friend-name">${peer.nickname}</div>
                    <div class="friend-status">
                        <span class="status-indicator ${peer.status === 'connected' ? 'online' : 'offline'}"></span>
                        ${peer.ip}:${peer.port}
                    </div>
                    <div class="friend-version">
                        版本: ${peer.version || '未知版本'}
                    </div>
                </div>
            `;
            
            friendItem.addEventListener('click', () => {
                this.selectPeer(peer);
            });
            
            friendsList.appendChild(friendItem);
        }
    }

    selectPeer(peer) {
        this.currentPeer = peer;
        
        // 更新UI
        document.querySelectorAll('.friend-item').forEach(item => {
            item.classList.remove('active');
        });
        event.currentTarget.classList.add('active');
        
        // 更新聊天头部
        document.querySelector('.chat-avatar').innerHTML = `<i class="${peer.avatar || 'fas fa-user'}"></i>`;
        document.querySelector('.chat-user-name').textContent = peer.nickname;
        document.querySelector('.chat-user-status').innerHTML = `
            <span class="status-indicator ${peer.status === 'connected' ? 'online' : 'offline'}"></span>
            ${peer.status === 'connected' ? '在线' : '离线'}
        `;
        document.querySelector('.chat-user-version').textContent = `版本: ${peer.version || '未知版本'}`;
        
        // 启用输入和按钮
        document.getElementById('message-input').disabled = false;
        document.getElementById('send-btn').disabled = false;
        document.getElementById('file-btn').disabled = false;
        document.getElementById('send-file-btn').disabled = false;
        document.getElementById('clear-chat-btn').disabled = false;
        
        // 加载聊天记录
        this.loadChatHistory(peer.id);
        
        // 开始轮询该用户的服务器
        this.startPollingPeer(peer);
    }

    startPollingPeer(peer) {
        // 如果已经在轮询，先停止
        if (this.pollIntervals.has(peer.id)) {
            clearInterval(this.pollIntervals.get(peer.id));
        }

        // 每3秒轮询一次
        const interval = setInterval(async () => {
            try {
                // 先ping检测连通性，使用对方的实际IP和端口
                const pingResponse = await fetch(`http://${peer.ip}:${peer.port}/api/ping`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        user: this.localUser
                    }),
                    signal: AbortSignal.timeout(3000)
                });
                
                if (pingResponse.ok) {
                    // 获取对方的聊天记录
                    const chatResponse = await fetch(`http://${peer.ip}:${peer.port}/api/chat/${this.localUser.id}`, {
                        signal: AbortSignal.timeout(5000)
                    });
                    
                    if (chatResponse.ok) {
                        const remoteHistory = await chatResponse.json();
                        this.syncChatHistory(peer.id, remoteHistory);
                    }
                    
                    // 更新连接状态
                    peer.status = 'connected';
                    peer.lastSeen = Date.now();
                    
                    // 如果是当前聊天用户，更新状态显示
                    if (this.currentPeer && this.currentPeer.id === peer.id) {
                        const statusEl = document.querySelector('.chat-user-status');
                        if (statusEl) {
                            statusEl.innerHTML = `
                                <span class="status-indicator online"></span>
                                在线 (${peer.ip}:${peer.port})
                            `;
                        }
                    }
                } else {
                    throw new Error(`Ping失败: ${pingResponse.status}`);
                }
            } catch (error) {
                console.log(`轮询 ${peer.nickname} (${peer.ip}:${peer.port}) 失败:`, error.message);
                peer.status = 'disconnected';
                
                // 如果是当前聊天用户，更新状态
                if (this.currentPeer && this.currentPeer.id === peer.id) {
                    const statusEl = document.querySelector('.chat-user-status');
                    if (statusEl) {
                        statusEl.innerHTML = `
                            <span class="status-indicator offline"></span>
                            离线 (最后在线: ${new Date(peer.lastSeen || 0).toLocaleTimeString()})
                        `;
                    }
                }
            }
        }, 3000);

        this.pollIntervals.set(peer.id, interval);
    }

    syncChatHistory(peerId, remoteHistory) {
        const localHistory = this.chatHistory.get(peerId) || [];
        const localMessageIds = new Set(localHistory.map(msg => msg.id));
        
        // 找出本地没有的消息（只接收对方发送的消息，避免重复）
        const newMessages = remoteHistory.filter(msg => 
            !localMessageIds.has(msg.id) && msg.senderId === peerId
        );
        
        // 添加新消息到本地历史
        if (newMessages.length > 0) {
            const updatedHistory = [...localHistory, ...newMessages]
                .sort((a, b) => a.timestamp - b.timestamp);
            this.chatHistory.set(peerId, updatedHistory);
            
            // 聊天历史已通过addMessageToHistory自动保存
            
            // 如果正在与该用户聊天，显示新消息
            if (this.currentPeer && this.currentPeer.id === peerId) {
                newMessages.forEach(msg => {
                    this.displayMessage(msg);
                });
                
                // 滚动到底部
                const messagesContainer = document.getElementById('chat-messages');
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
            
            console.log(`同步了 ${newMessages.length} 条新消息来自 ${peerId}`);
        }
    }

    loadChatHistory(peerId) {
        const messagesContainer = document.getElementById('chat-messages');
        
        // 检查是否已经显示了消息，避免重复加载
        const currentMessages = messagesContainer.querySelectorAll('.message');
        const history = this.chatHistory.get(peerId) || [];
        
        // 如果当前显示的消息数量与历史记录数量一致，且是同一个用户，则不重新加载
        if (currentMessages.length === history.length && this.currentPeer && this.currentPeer.id === peerId) {
            console.log('聊天记录已是最新，无需重新加载');
            return;
        }
        
        console.log('加载聊天记录，清空现有消息并重新显示');
        messagesContainer.innerHTML = '';
        
        history.forEach(message => {
            this.displayMessage(message);
        });
        
        // 滚动到底部
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    displayMessage(messageData) {
        const messagesContainer = document.getElementById('chat-messages');
        
        if (!messagesContainer) {
            console.error('找不到聊天消息容器!');
            return;
        }
        
        const messageEl = document.createElement('div');
        
        const isOwn = messageData.senderId === this.localUser.id;
        messageEl.className = `message ${isOwn ? 'sent' : 'received'}`;
        
        const time = new Date(messageData.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        if (messageData.type === 'file') {
            // 文件消息
            const fileInfo = messageData.fileInfo;
            if (!fileInfo || !fileInfo.originalName) {
                console.error('文件信息不完整:', messageData);
                return;
            }
            const fileIcon = this.getFileIcon(fileInfo.originalName);
            const fileCategory = this.getFileCategory(fileInfo.originalName);
            
            if (fileCategory === 'image') {
                // 图片文件直接显示预览
                messageEl.innerHTML = `
                    <div class="message-header">
                        <span class="message-sender">${messageData.senderNickname || '未知用户'}</span>
                        <span class="message-time">${time}</span>
                    </div>
                    <div class="message-content">
                        <div class="image-message">
                                <div class="image-preview">
                                    <img src="${fileInfo.downloadUrl}" alt="${fileInfo.originalName}" 
                                          onclick="toggleImageFullscreen(this)" 
                                          onerror="this.style.display='none'; this.nextElementSibling.style.display='block'">
                                    <div class="image-error" style="display: none;">
                                        <i class="fas fa-image"></i>
                                        <span>图片加载失败</span>
                                    </div>
                                </div>
                                <div class="image-info">
                                     <div class="file-info">
                                         <div class="file-name" title="${fileInfo.originalName}">${fileInfo.originalName}</div>
                                         <div class="file-size">${this.formatFileSize(fileInfo.size)} • ${fileIcon.type}</div>
                                     </div>
                                     <button class="file-download" onclick="app.downloadFile('${fileInfo.downloadUrl}', '${fileInfo.originalName}')">
                                         <i class="fas fa-download"></i>
                                         下载原图
                                     </button>
                             </div>
                        </div>
                    </div>
                `;
            } else {
                // 其他文件类型显示文件信息
                messageEl.innerHTML = `
                    <div class="message-header">
                        <span class="message-sender">${messageData.senderNickname || '未知用户'}</span>
                        <span class="message-time">${time}</span>
                    </div>
                    <div class="message-content">
                        <div class="file-message" data-file-type="${fileCategory}">
                                <i class="${fileIcon.class}" style="color: ${fileIcon.color}"></i>
                                <div class="file-info">
                                    <div class="file-name" title="${fileInfo.originalName}">${fileInfo.originalName}</div>
                                    <div class="file-size">${this.formatFileSize(fileInfo.size)} • ${fileIcon.type}</div>
                                </div>
                            <button class="file-download" onclick="app.downloadFile('${fileInfo.downloadUrl}', '${fileInfo.originalName}')">
                                <i class="fas fa-download"></i>
                                下载
                            </button>
                        </div>
                    </div>
                `;
            }
        } else {
            // 文本消息
            messageEl.innerHTML = `
                <div class="message-header">
                    <span class="message-sender">${messageData.senderNickname || '未知用户'}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="message-content">
                    <div class="message-text">${this.escapeHtml(messageData.content)}</div>
                </div>
            `;
        }
        
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    async sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        
        if (!message || !this.currentPeer || !this.localUser) return;
        
        try {
            const success = await ipcRenderer.invoke('send-message', this.currentPeer.id, message);
            if (success) {
                // 创建消息数据
                const messageData = {
                    id: this.generateId(),
                    senderId: this.localUser.id,
                    senderNickname: this.localUser.nickname || '未知用户',
                    content: message,
                    type: 'text',
                    timestamp: Date.now()
                };
                
                // 添加到本地历史并显示
                this.addMessageToHistory(this.currentPeer.id, messageData);
                this.displayMessage(messageData);
                
                input.value = '';
                this.updateSendButton();
                this.autoResizeTextarea();
            } else {
                this.showNotification('发送失败', '消息发送失败，请检查网络连接', 'error');
            }
        } catch (error) {
            console.error('发送消息失败:', error);
            this.showNotification('发送失败', error.message, 'error');
        }
    }

    async selectAndSendFile() {
        if (!this.currentPeer) {
            this.showNotification('错误', '请先选择一个好友', 'error');
            return;
        }
        
        try {
            const filePath = await ipcRenderer.invoke('show-file-dialog');
            
            if (filePath) {
                await this.sendFile(filePath);
            }
        } catch (error) {
            console.error('选择文件失败:', error);
            this.showNotification('错误', '选择文件失败: ' + error.message, 'error');
        }
    }

    async sendFile(filePath) {
        if (!this.currentPeer || !this.localUser) {
            this.showNotification('错误', '请先选择一个好友', 'error');
            return;
        }
        
        try {
            // 获取文件信息
            const fs = require('fs');
            const path = require('path');
            const stats = fs.statSync(filePath);
            const fileName = path.basename(filePath);
            
            // 立即在聊天记录中显示文件消息（使用本地文件路径）
            const messageData = {
                id: this.generateId(),
                type: 'file',
                senderId: this.localUser.id,
                senderNickname: this.localUser.nickname || '未知用户',
                timestamp: Date.now(),
                fileInfo: {
                    originalName: fileName,
                    size: stats.size,
                    downloadUrl: `file:///${filePath.replace(/\\/g, '/')}`, // 本地文件URL
                    localPath: filePath
                }
            };
            
            // 添加到聊天历史并显示
            this.addMessageToHistory(this.currentPeer.id, messageData);
            this.displayMessage(messageData);
            
            // 异步发送文件到对方（不影响本地显示）
            ipcRenderer.invoke('send-file', this.currentPeer.id, filePath)
                .then(result => {
                    if (result) {
                        this.showNotification('发送成功', '文件已发送给对方', 'success');
                    } else {
                        this.showNotification('发送失败', '文件发送给对方失败，但本地记录已保存', 'warning');
                    }
                })
                .catch(error => {
                    console.error('发送文件到对方失败:', error);
                    this.showNotification('发送失败', '文件发送给对方失败，但本地记录已保存', 'warning');
                });
                
        } catch (error) {
            console.error('处理文件失败:', error);
            this.showNotification('错误', '无法读取文件信息', 'error');
        }
    }

    clearChat() {
        if (!this.currentPeer) return;
        
        if (confirm('确定要清空与该好友的聊天记录吗？')) {
            this.chatHistory.delete(this.currentPeer.id);
            document.getElementById('chat-messages').innerHTML = '';
            this.showNotification('成功', '聊天记录已清空', 'success');
        }
    }

    updateSendButton() {
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        sendBtn.disabled = !input.value.trim() || !this.currentPeer;
    }

    autoResizeTextarea() {
        const textarea = document.getElementById('message-input');
        
        // 先重置高度为auto以获取正确的scrollHeight
        textarea.style.height = 'auto';
        
        // 计算新的高度
        const scrollHeight = textarea.scrollHeight;
        const maxHeight = 200; // 增加最大高度
        const minHeight = 40;  // 最小高度
        
        // 如果内容为空，重置为最小高度
        if (!textarea.value.trim()) {
            textarea.style.height = minHeight + 'px';
            textarea.style.overflowY = 'hidden';
            return;
        }
        
        // 设置新高度，但不超过最大高度
        const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
        textarea.style.height = newHeight + 'px';
        
        // 如果内容超过最大高度，显示滚动条
        if (scrollHeight > maxHeight) {
            textarea.style.overflowY = 'auto';
        } else {
            textarea.style.overflowY = 'hidden';
        }
    }

    addMessageToHistory(peerId, message) {
        if (!this.chatHistory.has(peerId)) {
            this.chatHistory.set(peerId, []);
        }
        const history = this.chatHistory.get(peerId);
        history.push(message);
        
        // 保持历史记录不超过1000条
        if (history.length > 1000) {
            history.splice(0, history.length - 1000);
        }
        
        // 保存聊天历史到本地文件
        this.saveChatHistoryToFile();
    }
    
    async saveChatHistoryToFile() {
        try {
            // 将Map转换为普通对象以便JSON序列化
            const historyObj = {};
            for (const [peerId, messages] of this.chatHistory) {
                historyObj[peerId] = messages;
            }
            
            await ipcRenderer.invoke('save-chat-history', historyObj);
        } catch (error) {
            console.error('保存聊天历史失败:', error);
        }
    }
    
    async loadChatHistoryFromFile() {
        try {
            const historyObj = await ipcRenderer.invoke('load-chat-history');
            if (historyObj) {
                // 将普通对象转换回Map
                this.chatHistory.clear();
                for (const [peerId, messages] of Object.entries(historyObj)) {
                    this.chatHistory.set(peerId, messages);
                }
                console.log('聊天历史加载成功');
            }
        } catch (error) {
            console.error('加载聊天历史失败:', error);
        }
    }

    showNotification(title, message, type = 'info') {
        const container = document.getElementById('notification-container');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const iconMap = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            info: 'fas fa-info-circle'
        };
        
        notification.innerHTML = `
            <div class="notification-icon">
                <i class="${iconMap[type]}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.remove();
        });
        
        container.appendChild(notification);
        
        // 自动移除
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    getFileIcon(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        
        // 图片文件
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
            return { class: 'fas fa-image', color: '#48bb78', type: '图片' };
        }
        
        // 视频文件
        if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) {
            return { class: 'fas fa-video', color: '#ed64a6', type: '视频' };
        }
        
        // 音频文件
        if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'].includes(ext)) {
            return { class: 'fas fa-music', color: '#9f7aea', type: '音频' };
        }
        
        // 文档文件
        if (['pdf'].includes(ext)) {
            return { class: 'fas fa-file-pdf', color: '#e53e3e', type: 'PDF' };
        }
        
        if (['doc', 'docx'].includes(ext)) {
            return { class: 'fas fa-file-word', color: '#2b6cb0', type: 'Word' };
        }
        
        if (['xls', 'xlsx'].includes(ext)) {
            return { class: 'fas fa-file-excel', color: '#38a169', type: 'Excel' };
        }
        
        if (['ppt', 'pptx'].includes(ext)) {
            return { class: 'fas fa-file-powerpoint', color: '#d69e2e', type: 'PowerPoint' };
        }
        
        // 压缩文件
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
            return { class: 'fas fa-file-archive', color: '#805ad5', type: '压缩包' };
        }
        
        // 代码文件
        if (['js', 'ts', 'html', 'css', 'py', 'java', 'cpp', 'c', 'php', 'go', 'rs'].includes(ext)) {
            return { class: 'fas fa-file-code', color: '#319795', type: '代码' };
        }
        
        // 文本文件
        if (['txt', 'md', 'log'].includes(ext)) {
            return { class: 'fas fa-file-alt', color: '#718096', type: '文本' };
        }
        
        // 默认文件
        return { class: 'fas fa-file', color: '#667eea', type: '文件' };
    }

    getFileCategory(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
            return 'image';
        }
        
        if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) {
            return 'video';
        }
        
        if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'].includes(ext)) {
            return 'audio';
        }
        
        if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
            return 'document';
        }
        
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
            return 'archive';
        }
        
        if (['js', 'ts', 'html', 'css', 'py', 'java', 'cpp', 'c', 'php', 'go', 'rs'].includes(ext)) {
            return 'code';
        }
        
        return 'other';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    generateId() {
        return Math.random().toString(36).substr(2, 9);
    }

    downloadFile(url, filename) {
        try {
            // 创建隐藏的下载链接
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            
            // 添加到DOM，触发下载，然后移除
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            this.showNotification('下载开始', `正在下载 ${filename}`, 'success');
        } catch (error) {
            console.error('下载文件失败:', error);
            this.showNotification('下载失败', '文件下载失败，请重试', 'error');
        }
    }

    cleanup() {
        // 停止心跳检测
        this.stopHeartbeat();
        
        // 停止所有轮询
        for (const [peerId, interval] of this.pollIntervals) {
            clearInterval(interval);
        }
        this.pollIntervals.clear();
        
        console.log('应用清理完成');
    }
}

// 全局函数：切换图片全屏显示
function toggleImageFullscreen(img) {
    if (img.classList.contains('fullscreen')) {
        // 退出全屏
        img.classList.remove('fullscreen');
        const backdrop = document.querySelector('.fullscreen-backdrop');
        if (backdrop) {
            backdrop.remove();
        }
        document.body.style.overflow = '';
    } else {
        // 进入全屏
        img.classList.add('fullscreen');
        
        // 创建背景遮罩
        const backdrop = document.createElement('div');
        backdrop.className = 'fullscreen-backdrop';
        backdrop.onclick = () => toggleImageFullscreen(img);
        document.body.appendChild(backdrop);
        
        // 禁止页面滚动
        document.body.style.overflow = 'hidden';
    }
}

// 监听ESC键退出全屏
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const fullscreenImg = document.querySelector('.image-preview img.fullscreen');
        if (fullscreenImg) {
            toggleImageFullscreen(fullscreenImg);
        }
    }
});

// 启动时自动连接方法
P2PChater.prototype.autoConnectOnStartup = async function() {
    if (!this.recentPeers || this.recentPeers.length === 0) {
        console.log('没有历史连接记录，跳过自动连接');
        return;
    }
    
    console.log(`启动时自动尝试连接 ${this.recentPeers.length} 个历史IP...`);
    
    // 遍历所有历史IP并尝试连接
    for (const peer of this.recentPeers) {
        try {
            console.log(`尝试连接: ${peer.nickname || '未知用户'} (${peer.ip}:${peer.port || 8888})`);
            
            // 尝试连接，不显示UI提示
            const success = await ipcRenderer.invoke('connect-to-peer', peer.ip, peer.port || 8888);
            
            if (success) {
                console.log(`自动连接成功: ${peer.nickname || '未知用户'} (${peer.ip}:${peer.port || 8888})`);
            } else {
                console.log(`自动连接失败: ${peer.nickname || '未知用户'} (${peer.ip}:${peer.port || 8888})`);
            }
            
            // 添加延迟避免过快连接
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            console.error(`自动连接 ${peer.nickname || '未知用户'} 时出错:`, error);
        }
    }
    
    console.log('启动时自动连接完成');
};

// 在P2PChater类中添加自动连接方法
P2PChater.prototype.autoConnectToFriends = async function() {
    // 首先清理掉线的peer
    try {
        await ipcRenderer.invoke('cleanup-offline-peers');
        console.log('自动连接前已清理掉线的peer');
    } catch (error) {
        console.warn('清理掉线peer时出错:', error);
    }
    
    if (this.peers.size === 0) {
        this.showNotification('提示', '暂无好友可连接', 'info');
        return;
    }
    
    const autoConnectBtn = document.getElementById('auto-connect-btn');
    const originalText = autoConnectBtn.innerHTML;
    
    // 禁用按钮并显示进度
    autoConnectBtn.disabled = true;
    autoConnectBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 连接中...';
    
    let connectedCount = 0;
    let totalCount = this.peers.size;
    
    this.showNotification('自动连接', `开始尝试连接 ${totalCount} 个好友...`, 'info');
    
    // 遍历所有好友并尝试连接
    for (const [peerId, peer] of this.peers) {
        if (peer.status === 'connected') {
            connectedCount++;
            continue; // 跳过已连接的好友
        }
        
        try {
            // 更新按钮状态
            autoConnectBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 连接 ${peer.nickname}...`;
            
            // 尝试连接
            const success = await ipcRenderer.invoke('connect-to-peer', peer.ip, peer.port);
            
            if (success) {
                connectedCount++;
                console.log(`成功连接到 ${peer.nickname} (${peer.ip}:${peer.port})`);
            } else {
                console.log(`连接失败: ${peer.nickname} (${peer.ip}:${peer.port})`);
            }
            
            // 添加延迟避免过快连接
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            console.error(`连接 ${peer.nickname} 时出错:`, error);
        }
    }
    
    // 恢复按钮状态
    autoConnectBtn.disabled = false;
    autoConnectBtn.innerHTML = originalText;
    
    // 显示连接结果
    const message = `自动连接完成！成功连接 ${connectedCount}/${totalCount} 个好友`;
    this.showNotification('连接完成', message, connectedCount > 0 ? 'success' : 'warning');
};

// 初始化应用
const app = new P2PChater();

// 导出供其他模块使用
window.P2PChater = app;