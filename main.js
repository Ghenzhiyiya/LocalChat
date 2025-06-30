const { app, BrowserWindow, Menu, ipcMain, dialog, shell, Tray } = require('electron');
const path = require('path');
const os = require('os');
const P2PServer = require('./src/server/p2pServer');

class LocalChaterApp {
    constructor() {
        this.mainWindow = null;
        this.p2pServer = null;
        this.tray = null;
        this.isDev = process.argv.includes('--dev');
    }

    async init() {
        // 禁用硬件加速以减少GPU相关问题
        app.disableHardwareAcceleration();
        
        await app.whenReady();
        this.createWindow();
        this.createTray();
        this.setupMenu();
        this.setupIPC();
        this.startP2PServer();

        app.on('window-all-closed', () => {
            // 不退出应用，保持托盘常驻
            // 在macOS上也保持运行
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                this.createWindow();
            }
        });
    }

    createWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            minWidth: 800,
            minHeight: 600,
            frame: false,
            titleBarStyle: 'hidden',
            show: false, // 初始不显示窗口
            backgroundColor: '#667eea', // 设置背景色匹配应用主题
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true,
                webSecurity: false, // 禁用web安全以减少GPU相关问题
                experimentalFeatures: false, // 禁用实验性功能
                backgroundThrottling: false // 禁用后台节流
            },
            icon: path.join(__dirname, 'assets/icon.png')
        });

        // 添加页面加载超时处理
        let readyTimeout = setTimeout(() => {
            console.warn('页面加载超时，强制显示窗口');
            this.forceShowWindow();
        }, 10000); // 10秒超时

        // 页面准备好后再显示窗口
        this.mainWindow.once('ready-to-show', () => {
            clearTimeout(readyTimeout);
            this.showWindowWithAnimation();
        });

        // 添加页面加载失败处理
        this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error('页面加载失败:', errorCode, errorDescription);
            clearTimeout(readyTimeout);
            this.handleLoadFailure();
        });

        // 添加渲染进程崩溃处理
        this.mainWindow.webContents.on('render-process-gone', (event, details) => {
            console.error('渲染进程崩溃:', details);
            this.handleRenderProcessCrash();
        });

        // 添加页面无响应处理
        this.mainWindow.webContents.on('unresponsive', () => {
            console.warn('页面无响应，尝试恢复');
            this.handlePageUnresponsive();
        });

        this.mainWindow.webContents.on('responsive', () => {
            console.log('页面恢复响应');
        });

        this.mainWindow.loadFile('src/renderer/index.html');
    }

    // 窗口显示动画方法
    showWindowWithAnimation() {
        // 添加延迟以确保页面完全加载
        setTimeout(() => {
            this.mainWindow.show();
            // 平滑显示动画
            this.mainWindow.setOpacity(0);
            this.mainWindow.show();
            
            // 渐入动画
            let opacity = 0;
            const fadeIn = setInterval(() => {
                opacity += 0.1;
                this.mainWindow.setOpacity(opacity);
                if (opacity >= 1) {
                    clearInterval(fadeIn);
                    this.mainWindow.setOpacity(1);
                }
            }, 16); // 约60fps
            
            if (this.isDev) {
                this.mainWindow.webContents.openDevTools();
            }
        }, 100);
    }

    // 强制显示窗口（超时情况下）
    forceShowWindow() {
        try {
            this.mainWindow.setOpacity(1);
            this.mainWindow.show();
            if (this.isDev) {
                this.mainWindow.webContents.openDevTools();
            }
            console.log('窗口已强制显示');
        } catch (error) {
            console.error('强制显示窗口失败:', error);
        }
    }

    // 处理页面加载失败
    handleLoadFailure() {
        const { dialog } = require('electron');
        dialog.showErrorBox('加载失败', '页面加载失败，请重启应用程序');
        this.forceShowWindow();
    }

    // 处理渲染进程崩溃
    handleRenderProcessCrash() {
        const { dialog } = require('electron');
        const choice = dialog.showMessageBoxSync(this.mainWindow, {
            type: 'error',
            title: '应用程序错误',
            message: '渲染进程崩溃，是否重新加载页面？',
            buttons: ['重新加载', '退出应用'],
            defaultId: 0
        });
        
        if (choice === 0) {
            this.mainWindow.reload();
        } else {
            this.quitApp();
        }
    }

    // 处理页面无响应
    handlePageUnresponsive() {
        const { dialog } = require('electron');
        const choice = dialog.showMessageBoxSync(this.mainWindow, {
            type: 'warning',
            title: '页面无响应',
            message: '页面可能卡死，是否重新加载？',
            buttons: ['重新加载', '继续等待', '退出应用'],
            defaultId: 0
        });
        
        if (choice === 0) {
            this.mainWindow.reload();
        } else if (choice === 2) {
            this.quitApp();
        }
        // choice === 1 时继续等待，不做任何操作

        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });

        // 添加窗口隐藏事件，当窗口被关闭时隐藏到托盘
        this.mainWindow.on('close', (event) => {
            if (!app.isQuiting) {
                event.preventDefault();
                this.mainWindow.hide();
                
                // 显示托盘通知
                if (this.tray) {
                    this.tray.displayBalloon({
                        iconType: 'info',
                        title: 'LocalChater',
                        content: '应用已最小化到系统托盘，双击托盘图标可重新打开窗口'
                    });
                }
                
                console.log('窗口已隐藏到托盘');
                return false;
            }
        });
    }

    createTray() {
        try {
            // 使用logo.png作为托盘图标
            const trayIconPath = path.join(__dirname, 'logo.png');
            console.log('托盘图标路径:', trayIconPath);
            
            // 检查图标文件是否存在
            const fs = require('fs');
            if (!fs.existsSync(trayIconPath)) {
                console.error('托盘图标文件不存在:', trayIconPath);
                return;
            }
            
            this.tray = new Tray(trayIconPath);
            console.log('系统托盘已创建');
            
            // 设置托盘提示文本
            this.tray.setToolTip('LocalChater - 本地聊天工具');
        
        // 创建托盘右键菜单
        const contextMenu = Menu.buildFromTemplate([
            {
                label: '显示主窗口',
                click: () => {
                    this.showMainWindow();
                }
            },
            {
                label: '隐藏窗口',
                click: () => {
                    if (this.mainWindow) {
                        this.mainWindow.hide();
                    }
                }
            },
            { type: 'separator' },
            {
                label: '关于',
                click: () => {
                    this.showMainWindow();
                    // 可以在这里添加关于对话框的逻辑
                }
            },
            { type: 'separator' },
            {
                label: '退出',
                click: () => {
                    this.quitApp();
                }
            }
        ]);
        
        // 设置托盘右键菜单
        this.tray.setContextMenu(contextMenu);
        
            // 托盘图标双击事件 - 显示/隐藏主窗口
            this.tray.on('double-click', () => {
                console.log('托盘图标双击');
                this.toggleMainWindow();
            });
            
            // 托盘图标单击事件 - 显示主窗口
            this.tray.on('click', () => {
                console.log('托盘图标单击');
                this.showMainWindow();
            });
            
            console.log('托盘事件监听器已设置');
        } catch (error) {
            console.error('创建系统托盘失败:', error);
        }
    }

    showMainWindow() {
        if (this.mainWindow) {
            if (this.mainWindow.isMinimized()) {
                this.mainWindow.restore();
            }
            this.mainWindow.show();
            this.mainWindow.focus();
        } else {
            this.createWindow();
        }
    }

    toggleMainWindow() {
        if (this.mainWindow) {
            if (this.mainWindow.isVisible()) {
                this.mainWindow.hide();
            } else {
                this.showMainWindow();
            }
        } else {
            this.createWindow();
        }
    }

    quitApp() {
        app.isQuiting = true;
        this.cleanup();
        app.quit();
    }

    setupMenu() {
        const template = [
            {
                label: '文件',
                submenu: [
                    {
                        label: '添加好友',
                        accelerator: 'CmdOrCtrl+N',
                        click: () => {
                            this.mainWindow.webContents.send('show-add-friend-dialog');
                        }
                    },
                    {
                        label: '发送文件',
                        accelerator: 'CmdOrCtrl+O',
                        click: async () => {
                            const result = await dialog.showOpenDialog(this.mainWindow, {
                                properties: ['openFile'],
                                filters: [
                                    { name: '所有文件', extensions: ['*'] }
                                ]
                            });
                            if (!result.canceled) {
                                this.mainWindow.webContents.send('file-selected', result.filePaths[0]);
                            }
                        }
                    },
                    { type: 'separator' },
                    {
                        label: '退出',
                        accelerator: 'CmdOrCtrl+Q',
                        click: () => {
                            this.cleanup();
                            app.quit();
                        }
                    }
                ]
            },
            {
                label: '设置',
                submenu: [
                    {
                        label: '修改昵称',
                        click: () => {
                            this.mainWindow.webContents.send('edit-nickname');
                        }
                    },
                    {
                        label: '设置头像',
                        click: () => {
                            this.mainWindow.webContents.send('edit-avatar');
                        }
                    },
                    {
                        label: '服务器设置',
                        click: () => {
                            this.mainWindow.webContents.send('server-settings');
                        }
                    }
                ]
            },
            {
                label: '帮助',
                submenu: [
                    {
                        label: '关于',
                        click: () => {
                            dialog.showMessageBox(this.mainWindow, {
                                type: 'info',
                                title: '关于 LocalChater',
                                message: 'LocalChater v1.0.0',
                                detail: '局域网P2P聊天软件\n支持文件传输和实时聊天'
                            });
                        }
                    }
                ]
            }
        ];

        if (this.isDev) {
            template.push({
                label: '开发',
                submenu: [
                    {
                        label: '重新加载',
                        accelerator: 'CmdOrCtrl+R',
                        click: () => {
                            this.mainWindow.reload();
                        }
                    },
                    {
                        label: '开发者工具',
                        accelerator: 'F12',
                        click: () => {
                            this.mainWindow.webContents.toggleDevTools();
                        }
                    }
                ]
            });
        }

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
    }

    setupIPC() {
        // 窗口控制
        ipcMain.handle('minimize-window', () => {
            this.mainWindow.minimize();
        });

        ipcMain.handle('maximize-window', () => {
            if (this.mainWindow.isMaximized()) {
                this.mainWindow.unmaximize();
            } else {
                this.mainWindow.maximize();
            }
        });

        ipcMain.handle('close-window', () => {
            // 不调用cleanup，让窗口关闭事件处理器处理隐藏到托盘的逻辑
            this.mainWindow.close();
        });

        // 获取本地IP
        ipcMain.handle('get-local-ip', () => {
            const interfaces = os.networkInterfaces();
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        return iface.address;
                    }
                }
            }
            return '127.0.0.1';
        });

        // P2P服务器相关
        ipcMain.handle('start-server', (event, port) => {
            return this.startP2PServer(port);
        });

        ipcMain.handle('stop-server', () => {
            return this.stopP2PServer();
        });

        ipcMain.handle('get-server-status', () => {
            return this.p2pServer ? this.p2pServer.getStatus() : null;
        });

        // 连接到其他用户
        ipcMain.handle('connect-to-peer', async (event, ip, port) => {
            if (this.p2pServer) {
                try {
                    return await this.p2pServer.connectToPeer(ip, port);
                } catch (error) {
                    console.error('连接失败:', error.message);
                    throw error; // 重新抛出错误，让前端能够捕获
                }
            }
            throw new Error('P2P服务器未启动');
        });

        // 发送消息
        ipcMain.handle('send-message', (event, peerId, message) => {
            if (this.p2pServer) {
                return this.p2pServer.sendMessage(peerId, message);
            }
            return false;
        });
        
        // 清理掉线的peer
        ipcMain.handle('cleanup-offline-peers', () => {
            if (this.p2pServer && this.p2pServer.dataManager) {
                this.p2pServer.dataManager.cleanupOfflinePeers();
                return true;
            }
            return false;
        });
        
        // 强制清理所有掉线的peer
        ipcMain.handle('force-cleanup-offline-peers', () => {
            if (this.p2pServer && this.p2pServer.dataManager) {
                this.p2pServer.dataManager.forceCleanupOfflinePeers();
                return true;
            }
            return false;
        });
        
        // 扫描同网段的8888端口
        ipcMain.handle('scan-network', async (event, baseIP) => {
            if (this.p2pServer) {
                return await this.p2pServer.scanNetwork(baseIP);
            }
            return [];
        });

        // 显示文件选择对话框
        ipcMain.handle('show-file-dialog', async () => {
            const { dialog } = require('electron');
            const result = await dialog.showOpenDialog(this.mainWindow, {
                properties: ['openFile'],
                filters: [
                    { name: '所有文件', extensions: ['*'] },
                    { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp'] },
                    { name: '文档', extensions: ['txt', 'doc', 'docx', 'pdf'] },
                    { name: '音频', extensions: ['mp3', 'wav', 'flac'] },
                    { name: '视频', extensions: ['mp4', 'avi', 'mkv'] }
                ]
            });
            
            if (!result.canceled && result.filePaths.length > 0) {
                return result.filePaths[0];
            }
            return null;
        });

        // 发送文件
        ipcMain.handle('send-file', async (event, peerId, filePath) => {
            if (this.p2pServer) {
                try {
                    return await this.p2pServer.sendFile(peerId, filePath);
                } catch (error) {
                    console.error('发送文件失败:', error);
                    throw error;
                }
            }
            return false;
        });

        // 获取聊天记录
        ipcMain.handle('get-chat-history', (event, peerId) => {
            if (this.p2pServer) {
                return this.p2pServer.getChatHistory(peerId);
            }
            return [];
        });

        // 获取连接的用户列表
        ipcMain.handle('get-connected-peers', () => {
            if (this.p2pServer) {
                return this.p2pServer.getConnectedPeers();
            }
            return [];
        });

        // 更新用户信息
        ipcMain.handle('update-user-info', async (event, userInfo) => {
            if (this.p2pServer) {
                try {
                    const result = await this.p2pServer.updateUserInfo(userInfo);
                    if (result.success) {
                        return { success: true, userInfo: result.userInfo };
                    } else {
                        throw new Error(result.error || '更新用户信息失败');
                    }
                } catch (error) {
                    console.error('更新用户信息失败:', error);
                    return { success: false, error: error.message };
                }
            }
            throw new Error('P2P服务器未启动');
        });

        // 获取用户信息
        ipcMain.handle('get-user-info', () => {
            if (this.p2pServer) {
                return this.p2pServer.getUserInfo();
            }
            return null;
        });
        
        // 保存聊天历史
        ipcMain.handle('save-chat-history', async (event, historyData) => {
            try {
                const fs = require('fs').promises;
                const dataDir = path.join(os.tmpdir(), 'localchater');
                
                // 确保数据目录存在
                try {
                    await fs.access(dataDir);
                } catch {
                    await fs.mkdir(dataDir, { recursive: true });
                }
                
                const historyPath = path.join(dataDir, 'chatHistory.json');
                await fs.writeFile(historyPath, JSON.stringify(historyData, null, 2), 'utf8');
                return true;
            } catch (error) {
                console.error('保存聊天历史失败:', error);
                return false;
            }
        });
        
        // 加载聊天历史
        ipcMain.handle('load-chat-history', async () => {
            try {
                const fs = require('fs').promises;
                const dataDir = path.join(os.tmpdir(), 'localchater');
                const historyPath = path.join(dataDir, 'chatHistory.json');
                
                const data = await fs.readFile(historyPath, 'utf8');
                return JSON.parse(data);
            } catch (error) {
                // 文件不存在或读取失败时返回null
                console.log('聊天历史文件不存在或读取失败，将创建新的历史记录');
                return null;
            }
        });
    }

    async startP2PServer(port = 8888) {
        try {
            if (this.p2pServer) {
                await this.stopP2PServer();
            }

            this.p2pServer = new P2PServer(port);
            
            // 设置事件监听
            this.p2pServer.on('peer-connected', (peer) => {
                this.mainWindow.webContents.send('peer-connected', peer);
            });

            this.p2pServer.on('peer-disconnected', (peerId) => {
                this.mainWindow.webContents.send('peer-disconnected', peerId);
            });

            this.p2pServer.on('message-received', (peerId, message) => {
                this.mainWindow.webContents.send('message-received', peerId, message);
            });

            this.p2pServer.on('file-received', (peerId, fileInfo) => {
                this.mainWindow.webContents.send('file-received', peerId, fileInfo);
            });

            this.p2pServer.on('peer-info-updated', (peerId, peerInfo) => {
                this.mainWindow.webContents.send('peer-info-updated', peerId, peerInfo);
            });

            this.p2pServer.on('error', (error) => {
                this.mainWindow.webContents.send('server-error', error.message);
            });

            await this.p2pServer.start();
            console.log(`P2P服务器启动在端口 ${port}`);
            return true;
        } catch (error) {
            console.error('启动P2P服务器失败:', error);
            return false;
        }
    }

    async stopP2PServer() {
        if (this.p2pServer) {
            await this.p2pServer.stop();
            this.p2pServer = null;
            console.log('P2P服务器已停止');
            return true;
        }
        return false;
    }

    cleanup() {
        if (this.p2pServer) {
            this.p2pServer.stop();
        }
        
        // 清理托盘资源
        if (this.tray) {
            this.tray.destroy();
            this.tray = null;
        }
    }
}

const localChaterApp = new LocalChaterApp();
localChaterApp.init();

module.exports = LocalChaterApp;