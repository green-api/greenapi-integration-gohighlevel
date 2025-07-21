import { Controller, Get, Post, Body, Res, HttpCode, HttpStatus } from "@nestjs/common";
import { Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { GreenApiLogger } from "@green-api/greenapi-integration";
import { ConfigService } from "@nestjs/config";
import * as CryptoJS from "crypto-js";

@Controller("app")
export class CustomPageController {
	private readonly logger = GreenApiLogger.getInstance(CustomPageController.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {}

	@Get("whatsapp")
	async getCustomPage(@Res() res: Response) {
		res.setHeader("X-Frame-Options", "ALLOWALL");
		res.setHeader("Content-Security-Policy", "frame-ancestors *");
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "*");

		res.send(this.generateCustomPageHTML());
	}

	@Post("decrypt-user-data")
	@HttpCode(HttpStatus.OK)
	async decryptUserData(@Body() body: { encryptedData: string }, @Res() res: Response) {
		try {
			const sharedSecret = this.configService.get<string>("GHL_SHARED_SECRET");
			if (!sharedSecret) {
				return res.status(400).json({error: "Shared secret not configured"});
			}

			const decrypted = CryptoJS.AES.decrypt(body.encryptedData, sharedSecret).toString(CryptoJS.enc.Utf8);
			const userData = JSON.parse(decrypted);

			this.logger.log("Decrypted user data:", userData);

			const locationId = userData.activeLocation || userData.companyId;

			if (!locationId) {
				return res.status(400).json({
					error: "No location ID found in user data",
					userData,
				});
			}

			const user = await this.prisma.findUser(locationId);

			return res.json({
				success: true,
				locationId,
				userData,
				user: user ? {
					id: user.id,
					companyId: user.companyId,
					hasTokens: !!(user.accessToken && user.refreshToken),
				} : null,
			});

		} catch (error) {
			this.logger.error("Error decrypting user data:", error);
			return res.status(400).json({
				error: "Failed to decrypt user data",
				details: error.message,
			});
		}
	}

	private generateCustomPageHTML(): string {
		return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>WhatsApp Integration - GREEN-API</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            line-height: 1.6;
          }
          
          .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.1);
            overflow: hidden;
            min-height: calc(100vh - 40px);
          }
          
          .header {
            background: linear-gradient(135deg, #3B9702 0%, #2d7200 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
            position: relative;
            overflow: hidden;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px);
            background-size: 30px 30px;
            animation: float 20s ease-in-out infinite;
          }
          
          @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-20px) rotate(180deg); }
          }
          
          .logo-container {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 20px;
            margin-bottom: 20px;
            position: relative;
            z-index: 2;
          }
          
          .logo {
            width: 60px;
            height: 60px;
            filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
          }
          
          .header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin: 0;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
            position: relative;
            z-index: 2;
          }
          
          .header p {
            font-size: 1.2rem;
            opacity: 0.9;
            margin-top: 10px;
            position: relative;
            z-index: 2;
          }
          
          .content {
            padding: 40px;
          }
          
          .loading {
            text-align: center;
            padding: 80px 40px;
            color: #666;
          }
          
          .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #3B9702;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 30px;
          }
          
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          
          .loading p {
            font-size: 1.1rem;
            color: #666;
          }
          
          .section {
            background: #f8f9fa;
            border-radius: 16px;
            padding: 30px;
            margin-bottom: 30px;
            border: 1px solid #e9ecef;
            transition: all 0.3s ease;
          }
          
          .section:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
          }
          
          .section h2 {
            color: #2d3436;
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
          }
          
          .status-card {
            background: white;
            border-radius: 12px;
            padding: 20px;
            border-left: 4px solid #3B9702;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
          }
          
          .status-card.warning {
            border-left-color: #f39c12;
          }
          
          .status-card.error {
            border-left-color: #e74c3c;
          }
          
          .form-group {
            margin-bottom: 20px;
          }
          
          .form-group label {
            display: block;
            font-weight: 600;
            color: #2d3436;
            margin-bottom: 8px;
            font-size: 0.95rem;
          }
          
          .form-group input {
            width: 100%;
            padding: 14px 16px;
            border: 2px solid #e9ecef;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s ease;
            background: white;
          }
          
          .form-group input:focus {
            outline: none;
            border-color: #3B9702;
            box-shadow: 0 0 0 3px rgba(59, 151, 2, 0.1);
            transform: translateY(-1px);
          }
          
          .form-group input::placeholder {
            color: #a0a0a0;
          }
          
          .btn {
            background: linear-gradient(135deg, #3B9702 0%, #2d7200 100%);
            color: white;
            padding: 14px 28px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 600;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
          }
          
          .btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
          }
          
          .btn:hover::before {
            left: 100%;
          }
          
          .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(59, 151, 2, 0.3);
          }
          
          .btn:active {
            transform: translateY(0);
          }
          
          .btn:disabled {
            background: #bdc3c7;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
          }
          
          .btn.danger {
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
          }
          
          .btn.danger:hover {
            box-shadow: 0 6px 20px rgba(231, 76, 60, 0.3);
          }
          
          .btn.secondary {
            background: linear-gradient(135deg, #74b9ff 0%, #0984e3 100%);
          }
          
          .btn.ghost {
            background: transparent;
            color: #636e72;
            border: 2px solid #e9ecef;
          }
          
          .btn.ghost:hover {
            background: #f8f9fa;
            border-color: #dee2e6;
            transform: none;
            box-shadow: none;
          }
          
          .alert {
            padding: 16px 20px;
            border-radius: 10px;
            margin: 20px 0;
            font-weight: 500;
            border: none;
            position: relative;
            overflow: hidden;
          }
          
          .alert::before {
            content: '';
            position: absolute;
            left: 0;
            top: 0;
            height: 100%;
            width: 4px;
            background: currentColor;
          }
          
          .alert.success {
            background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
            color: #155724;
          }
          
          .alert.error {
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            color: #721c24;
          }
          
          .alert.info {
            background: linear-gradient(135deg, #d1ecf1 0%, #bee5eb 100%);
            color: #0c5460;
          }
          
          .alert.warning {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            color: #856404;
          }
          
          .hidden {
            display: none;
          }
          
          .instances-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 25px;
            margin-top: 25px;
          }
          
          .instance-card {
            background: white;
            border-radius: 16px;
            padding: 25px;
            position: relative;
            transition: all 0.3s ease;
            border: 1px solid #e9ecef;
            overflow: hidden;
          }
          
          .instance-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #3B9702, #25D366);
          }
          
          .instance-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 35px rgba(0,0,0,0.1);
          }
          
          .status-badge {
            position: absolute;
            top: 20px;
            right: 20px;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          .status-badge.authorized {
            background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
            color: #155724;
          }
          
          .status-badge.notAuthorized {
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            color: #721c24;
          }
          
          .status-badge.starting {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            color: #856404;
          }
          
          .status-badge.yellowCard {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            color: #856404;
          }
          
          .status-badge.blocked {
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            color: #721c24;
          }
          
          .instance-name {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 15px;
            color: #2d3436;
            display: flex;
            align-items: center;
            gap: 10px;
            padding-right: 100px;
          }
          
          .instance-name input {
            flex: 1;
            padding: 8px 12px;
            font-size: 1rem;
            font-weight: 600;
            background: #f8f9fa;
            border: 2px solid #e9ecef;
          }
          
          .instance-name .btn {
            padding: 8px 16px;
            font-size: 14px;
          }
          
          .instance-id {
            color: #636e72;
            font-size: 0.9rem;
            margin-bottom: 15px;
            font-family: 'Courier New', monospace;
            background: #f8f9fa;
            padding: 8px 12px;
            border-radius: 6px;
            display: inline-block;
          }
          
          .instance-meta {
            color: #636e72;
            font-size: 0.9rem;
            margin-bottom: 20px;
          }
          
          .instance-actions {
            display: flex;
            gap: 12px;
            margin-top: 20px;
          }
          
          .instance-actions .btn {
            padding: 10px 18px;
            font-size: 14px;
            flex: 1;
          }
          
          .empty-state {
            text-align: center;
            padding: 60px 40px;
            color: #636e72;
          }
          
          .empty-state-icon {
            font-size: 4rem;
            margin-bottom: 20px;
            opacity: 0.5;
          }
          
          .empty-state h3 {
            color: #2d3436;
            font-size: 1.5rem;
            margin-bottom: 10px;
            font-weight: 600;
          }
          
          .empty-state p {
            font-size: 1.1rem;
            opacity: 0.8;
          }
          
          .error-section {
            text-align: center;
            padding: 60px 40px;
          }
          
          .error-section h2 {
            color: #e74c3c;
            font-size: 2rem;
            margin-bottom: 20px;
          }
          
          /* Custom Modal Styles */
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s ease;
          }
          
          .modal-overlay.show {
            opacity: 1;
            visibility: visible;
          }
          
          .modal {
            background: white;
            border-radius: 16px;
            padding: 30px;
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            transform: translateY(-20px) scale(0.95);
            transition: all 0.3s ease;
          }
          
          .modal-overlay.show .modal {
            transform: translateY(0) scale(1);
          }
          
          .modal-header {
            margin-bottom: 20px;
          }
          
          .modal-title {
            font-size: 1.5rem;
            font-weight: 600;
            color: #2d3436;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          .modal-body {
            margin-bottom: 25px;
            color: #636e72;
            line-height: 1.6;
          }
          
          .modal-actions {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
          }
          
          .modal-actions .btn {
            padding: 12px 24px;
            font-size: 14px;
          }
          
          .instance-actions {
            display: flex;
            gap: 12px;
            margin-top: 20px;
            flex-wrap: wrap;
          }
			
          .instance-actions .btn {
            padding: 10px 18px;
            font-size: 14px;
            flex: 1;
            min-width: 100px;
          }
			
          .btn[title*="Console"] {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            position: relative;
          }
			
          .btn[title*="Console"]:hover {
            background: linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.3);
          }
          
          @media (max-width: 768px) {
		    .instance-actions {
			  flex-direction: column;
		    }
		  
		    .instance-actions .btn {
			  width: 100%;
			  margin-bottom: 8px;
			  flex: none;
		    }
            body {
              padding: 10px;
            }
            
            .container {
              border-radius: 15px;
              min-height: calc(100vh - 20px);
            }
            
            .header {
              padding: 30px 20px;
            }
            
            .header h1 {
              font-size: 2rem;
            }
            
            .content {
              padding: 20px;
            }
            
            .section {
              padding: 20px;
            }
            
            .instances-grid {
              grid-template-columns: 1fr;
              gap: 20px;
            }
            
            .status-grid {
              grid-template-columns: 1fr;
            }
            
            .modal {
              margin: 20px;
              padding: 25px;
            }
            
            .modal-actions {
              flex-direction: column-reverse;
            }
            
            .modal-actions .btn {
              width: 100%;
              margin-bottom: 10px;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo-container">
              <svg class="logo" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="1000px" height="1000px" version="1.1" style="shape-rendering:geometricPrecision; text-rendering:geometricPrecision; image-rendering:optimizeQuality; fill-rule:evenodd; clip-rule:evenodd" viewBox="0 0 98.822 98.823" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xodm="http://www.corel.com/coreldraw/odm/2003">
                <defs>
                  <style type="text/css">
                    <![CDATA[
                    .fil0 {fill:#3B9702}
                    .fil1 {fill:white}
                    .fil2 {fill:white;fill-rule:nonzero}
                    ]]>
                  </style>
                </defs>
                <g id="Слой_x0020_1">
                  <metadata id="CorelCorpID_0Corel-Layer"/>
                  <g id="_2274748282416">
                    <circle class="fil0" cx="49.411" cy="49.411" r="49.411"/>
                    <path class="fil1" d="M80.075 18.748c-7.846,-7.847 -18.688,-12.701 -30.663,-12.701 -11.976,0 -22.818,4.854 -30.664,12.701 -7.847,7.847 -12.701,18.689 -12.701,30.664 0,11.975 4.854,22.817 12.701,30.664 7.847,7.846 18.689,12.7 30.664,12.7 11.975,0 22.816,-4.853 30.663,-12.7 7.847,-7.847 12.701,-18.689 12.701,-30.664 0,-11.975 -4.854,-22.817 -12.701,-30.664zm-3.425 3.425c-6.971,-6.97 -16.601,-11.282 -27.238,-11.282 -10.638,0 -20.269,4.312 -27.239,11.282 -6.97,6.97 -11.282,16.601 -11.282,27.239 0,10.637 4.312,20.268 11.282,27.238 6.97,6.97 16.601,11.282 27.239,11.282 10.637,0 20.267,-4.311 27.238,-11.282 6.97,-6.97 11.281,-16.601 11.281,-27.238 0,-10.638 -4.311,-20.268 -11.281,-27.239z"/>
                    <path class="fil2" d="M50.839 74.623c-3.9,0 -7.417,-0.627 -10.552,-1.88 -3.134,-1.254 -5.838,-3.018 -8.113,-5.293 -2.275,-2.275 -4.016,-4.945 -5.224,-8.01 -1.207,-3.064 -1.81,-6.407 -1.81,-10.029 0,-3.622 0.65,-6.964 1.95,-10.029 1.3,-3.064 3.122,-5.734 5.466,-8.009 2.346,-2.275 5.131,-4.04 8.358,-5.293 3.227,-1.254 6.768,-1.881 10.622,-1.881 2.646,0 5.165,0.348 7.556,1.045 2.391,0.697 4.573,1.648 6.547,2.855 1.973,1.208 3.61,2.577 4.91,4.11l-7.313 7.661c-1.671,-1.579 -3.47,-2.821 -5.397,-3.726 -1.927,-0.906 -4.098,-1.358 -6.513,-1.358 -1.996,0 -3.842,0.359 -5.536,1.079 -1.695,0.72 -3.181,1.741 -4.457,3.065 -1.277,1.323 -2.264,2.878 -2.961,4.666 -0.696,1.787 -1.044,3.726 -1.044,5.815 0,2.09 0.371,4.017 1.114,5.781 0.743,1.765 1.776,3.308 3.1,4.632 1.322,1.323 2.866,2.356 4.631,3.099 1.764,0.743 3.668,1.114 5.711,1.114 1.439,0 2.774,-0.22 4.005,-0.661 1.23,-0.442 2.321,-1.045 3.273,-1.811 0.952,-0.767 1.695,-1.672 2.229,-2.717 0.533,-1.045 0.801,-2.17 0.801,-3.377l0 -1.811 1.532 2.367 -13.303 0 0 -9.402 22.914 0c0.093,0.511 0.163,1.207 0.209,2.09 0.046,0.882 0.081,1.729 0.104,2.542 0.024,0.813 0.035,1.451 0.035,1.915 0,3.157 -0.568,6.047 -1.706,8.671 -1.137,2.624 -2.739,4.887 -4.806,6.791 -2.066,1.903 -4.492,3.378 -7.278,4.422 -2.785,1.045 -5.804,1.567 -9.054,1.567l0 0z"/>
                  </g>
                </g>
              </svg>
              <h1>WhatsApp Integration</h1>
            </div>
            <p>Manage your GREEN-API instances with ease</p>
          </div>

          <div class="content">
            <div id="loadingSection" class="loading">
              <div class="spinner"></div>
              <p>Connecting to GoHighLevel...</p>
            </div>

            <div id="errorSection" class="section hidden">
              <div class="error-section">
                <h2>❌ Connection Failed</h2>
                <div id="errorMessage" class="alert error"></div>
              </div>
            </div>

            <div id="mainContent" class="hidden">
              <div class="section">
                <h2>📊 Connection Status</h2>
                <div id="statusInfo" class="status-grid"></div>
              </div>

              <div id="instancesSection" class="section">
                <h2>📱 Your WhatsApp Instances</h2>
                <div id="instancesList" class="instances-grid"></div>
              </div>

              <div class="section">
                <h2>➕ Add New Instance</h2>
                <form id="instanceForm">
                  <div class="form-group">
                    <label for="instanceId">Instance ID</label>
                    <input type="text" id="instanceId" name="instanceId" placeholder="e.g., 1234567890" required>
                  </div>
                  
                  <div class="form-group">
                    <label for="apiToken">API Token</label>
                    <input type="text" id="apiToken" name="apiToken" placeholder="Your GREEN-API token" required>
                  </div>
                  
                  <div class="form-group">
                    <label for="instanceName">Instance Name (optional)</label>
                    <input type="text" id="instanceName" name="instanceName" placeholder="e.g., Sales Team WhatsApp">
                  </div>
                  
                  <button type="submit" id="submitBtn" class="btn">Add Instance</button>
                </form>
                
                <div id="result"></div>
              </div>
            </div>
          </div>
        </div>

        <div id="customModal" class="modal-overlay">
          <div class="modal">
            <div class="modal-header">
              <div id="modalTitle" class="modal-title"></div>
            </div>
            <div id="modalBody" class="modal-body"></div>
            <div class="modal-actions">
              <button id="modalCancel" class="btn ghost hidden">Cancel</button>
              <button id="modalConfirm" class="btn">OK</button>
            </div>
          </div>
        </div>

        <script>
          class ModalSystem {
            constructor() {
              this.modal = document.getElementById('customModal');
              this.title = document.getElementById('modalTitle');
              this.body = document.getElementById('modalBody');
              this.confirmBtn = document.getElementById('modalConfirm');
              this.cancelBtn = document.getElementById('modalCancel');
              
              this.setupEventListeners();
            }
            
            setupEventListeners() {
              this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                  this.hide();
                }
              });
              
              document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.modal.classList.contains('show')) {
                  this.hide();
                }
              });
            }
            
            show() {
              this.modal.classList.add('show');
              document.body.style.overflow = 'hidden';
              setTimeout(() => this.confirmBtn.focus(), 100);
            }
            
            hide() {
              this.modal.classList.remove('show');
              document.body.style.overflow = '';
            }
            
            alert(message, title = 'Notice') {
              return new Promise((resolve) => {
                this.title.innerHTML = '<span style="color: #3B9702;">ℹ️</span> ' + title;
                this.body.textContent = message;
                this.cancelBtn.classList.add('hidden');
                this.confirmBtn.textContent = 'OK';
                this.confirmBtn.className = 'btn';
                
                const handleConfirm = () => {
                  this.hide();
                  this.confirmBtn.removeEventListener('click', handleConfirm);
                  resolve();
                };
                
                this.confirmBtn.addEventListener('click', handleConfirm);
                this.show();
              });
            }
            
            confirm(message, title = 'Confirm Action') {
              return new Promise((resolve) => {
                this.title.innerHTML = '<span style="color: #f39c12;">⚠️</span> ' + title;
                this.body.textContent = message;
                this.cancelBtn.classList.remove('hidden');
                this.confirmBtn.textContent = 'Confirm';
                this.confirmBtn.className = 'btn danger';
                
                const handleConfirm = () => {
                  this.hide();
                  this.confirmBtn.removeEventListener('click', handleConfirm);
                  this.cancelBtn.removeEventListener('click', handleCancel);
                  resolve(true);
                };
                
                const handleCancel = () => {
                  this.hide();
                  this.confirmBtn.removeEventListener('click', handleConfirm);
                  this.cancelBtn.removeEventListener('click', handleCancel);
                  resolve(false);
                };
                
                this.confirmBtn.addEventListener('click', handleConfirm);
                this.cancelBtn.addEventListener('click', handleCancel);
                this.show();
              });
            }
            
            error(message, title = 'Error') {
              return new Promise((resolve) => {
                this.title.innerHTML = '<span style="color: #e74c3c;">❌</span> ' + title;
                this.body.textContent = message;
                this.cancelBtn.classList.add('hidden');
                this.confirmBtn.textContent = 'OK';
                this.confirmBtn.className = 'btn danger';
                
                const handleConfirm = () => {
                  this.hide();
                  this.confirmBtn.removeEventListener('click', handleConfirm);
                  resolve();
                };
                
                this.confirmBtn.addEventListener('click', handleConfirm);
                this.show();
              });
            }
          }
          
          const modal = new ModalSystem();

          class GHLUserContextHandler {
            constructor() {
              this.userData = null;
              this.locationId = null;
              this.encryptedUserData = null;
              this.instances = [];
              this.init();
            }

            init() {
              window.addEventListener('message', this.handleMessage.bind(this));
              this.requestUserData();
              document.getElementById('instanceForm').addEventListener('submit', this.handleFormSubmit.bind(this));
              
              setTimeout(() => {
                if (!this.userData) {
                  this.handleError('Timeout: No response from GoHighLevel');
                }
              }, 10000);
            }
            
            openGreenApiConsole(instanceId) {
			  const consoleUrl = \`https://console.green-api.com/instanceList/\${instanceId}\`;
			  window.open(consoleUrl, '_blank', 'noopener,noreferrer');
			}

            handleMessage(event) {
              if (event.data && event.data.message === 'REQUEST_USER_DATA_RESPONSE') {
                this.handleUserDataResponse(event.data.payload);
              }
            }

            requestUserData() {
              window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
            }

            async handleUserDataResponse(encryptedUserData) {
              if (!encryptedUserData) {
                this.handleError('No encrypted user data received');
                return;
              }
              
              this.encryptedUserData = encryptedUserData;

              try {
                const response = await fetch('/app/decrypt-user-data', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ encryptedData: encryptedUserData })
                });

                const result = await response.json();
                
                if (result.success) {
                  this.userData = result.userData;
                  this.locationId = result.locationId;
                  this.displayMainContent(result);
                  
                  if (result.user && result.user.hasTokens) {
                    await this.loadInstances();
                  }
                } else {
                  this.handleError('Failed to decrypt user data: ' + result.error);
                }
              } catch (error) {
                this.handleError('Network error: ' + error.message);
              }
            }
            
            async makeAuthenticatedRequest(url, options = {}) {
				return fetch(url, {
				  ...options,
				  headers: {
					...options.headers,
					'X-GHL-Context': this.encryptedUserData,
					'Content-Type': 'application/json',
				  },
				});
			  }

            handleError(error) {
              document.getElementById('loadingSection').classList.add('hidden');
              document.getElementById('errorSection').classList.remove('hidden');
              document.getElementById('errorMessage').innerHTML = '<strong>Error:</strong> ' + error;
            }

            displayMainContent(data) {
              document.getElementById('loadingSection').classList.add('hidden');
              document.getElementById('mainContent').classList.remove('hidden');
              
              const statusHTML = \`
                <div class="status-card \${data.user && data.user.hasTokens ? 'success' : 'warning'}">
                  <strong>👤 User:</strong> \${data.userData.userName || 'Unknown'}<br>
                  <strong>✉️ Email:</strong> \${data.userData.email || 'Unknown'}<br>
                  <strong>📍 Location ID:</strong> \${data.locationId}
                </div>
                <div class="status-card \${data.user && data.user.hasTokens ? 'success' : 'warning'}">
                  <strong>🔐 OAuth Status:</strong><br>
                  \${data.user && data.user.hasTokens ? 
                    '✅ Authenticated and ready' : 
                    '⚠️ OAuth authentication required'}
                </div>
              \`;
              document.getElementById('statusInfo').innerHTML = statusHTML;
              
              if (!data.user || !data.user.hasTokens) {
                document.getElementById('instancesSection').innerHTML = \`
                  <h2>📱 Your WhatsApp Instances</h2>
                  <div class="alert warning">
                    <strong>⚠️ OAuth Required</strong><br>
                    OAuth authentication is required before you can manage instances.
                    Please complete the OAuth setup first.
                  </div>
                \`;
                document.querySelector('.section:last-child').style.display = 'none';
              }
            }

            async loadInstances() {
              try {
                const response = await this.makeAuthenticatedRequest(\`/api/instances/\${this.locationId}\`);
                const result = await response.json();
                
                if (result.success) {
                  this.instances = result.instances;
                  this.displayInstances();
                }
              } catch (error) {
                console.error('Failed to load instances:', error);
              }
            }

            displayInstances() {
              const instancesList = document.getElementById('instancesList');
              
              if (this.instances.length === 0) {
                instancesList.innerHTML = \`
                  <div class="empty-state">
                    <div class="empty-state-icon">📱</div>
                    <h3>No instances configured yet</h3>
                    <p>Add your first WhatsApp instance using the form below</p>
                  </div>
                \`;
                return;
              }
              
              instancesList.innerHTML = this.instances.map(instance => \`
                <div class="instance-card" data-instance-id="\${instance.id}">
                  <div class="status-badge \${instance.state}">\${instance.state || 'unknown'}</div>
                  <div class="instance-name">
                    <span id="name-display-\${instance.id}">\${instance.name || 'Unnamed Instance'}</span>
                    <input type="text" id="name-input-\${instance.id}" value="\${instance.name || ''}" class="hidden">
                    <button id="edit-btn-\${instance.id}" onclick="window.instanceHandler.editInstanceName('\${instance.id}')" class="btn secondary hidden">Save</button>
                  </div>
                  <div class="instance-id">Instance ID: \${instance.id}</div>
                  <div class="instance-meta">
                    <strong>Created:</strong> \${new Date(instance.createdAt).toLocaleDateString()}
                  </div>
                  <div class="instance-actions">
                  	<button onclick="window.instanceHandler.openGreenApiConsole('\${instance.id}')" class="btn" title="Open GREEN-API Console">
					  Open Console
					</button>
                    <button onclick="window.instanceHandler.toggleEditMode('\${instance.id}')" class="btn secondary">Edit Name</button>
                    <button class="btn danger" onclick="window.instanceHandler.deleteInstance('\${instance.id}')">Delete</button>
                  </div>
                </div>
              \`).join('');
            }

            toggleEditMode(instanceId) {
              const displayEl = document.getElementById(\`name-display-\${instanceId}\`);
              const inputEl = document.getElementById(\`name-input-\${instanceId}\`);
              const editBtn = document.getElementById(\`edit-btn-\${instanceId}\`);
              
              if (displayEl.classList.contains('hidden')) {
                displayEl.classList.remove('hidden');
                inputEl.classList.add('hidden');
                editBtn.classList.add('hidden');
              } else {
                displayEl.classList.add('hidden');
                inputEl.classList.remove('hidden');
                editBtn.classList.remove('hidden');
                inputEl.focus();
              }
            }

            async editInstanceName(instanceId) {
              const inputEl = document.getElementById(\`name-input-\${instanceId}\`);
              const newName = inputEl.value.trim();
              
              if (!newName) {
                await modal.alert('Please enter a valid name', 'Invalid Input');
                return;
              }
              
              try {
                const response = await this.makeAuthenticatedRequest(\`/api/instances/\${instanceId}\`, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ name: newName })
                });
                
                const result = await response.json();
                if (result.success) {
                  await this.loadInstances();
                } else {
                  await modal.error('Failed to update instance name', 'Update Failed');
                }
              } catch (error) {
                await modal.error('Error updating instance name: ' + error.message, 'Network Error');
              }
            }

            async deleteInstance(instanceId) {
              const confirmed = await modal.confirm(
                'Are you sure you want to delete this instance? This action cannot be undone.',
                'Delete Instance'
              );
              
              if (!confirmed) {
                return;
              }
              
              try {
                const response = await this.makeAuthenticatedRequest(\`/api/instances/\${instanceId}\`, {
                  method: 'DELETE'
                });
                
                const result = await response.json();
                if (result.success) {
                  await this.loadInstances();
                } else {
                  await modal.error('Failed to delete instance', 'Delete Failed');
                }
              } catch (error) {
                await modal.error('Error deleting instance: ' + error.message, 'Network Error');
              }
            }

            async handleFormSubmit(event) {
              event.preventDefault();
              
              const formData = new FormData(event.target);
              const submitBtn = document.getElementById('submitBtn');
              const resultDiv = document.getElementById('result');
              
              if (!this.locationId) {
                resultDiv.innerHTML = '<div class="alert error">❌ No location ID available</div>';
                return;
              }
              
              const payload = {
                locationId: this.locationId,
                instanceId: formData.get('instanceId'),
                apiToken: formData.get('apiToken'),
                name: formData.get('instanceName') || undefined
              };

              submitBtn.disabled = true;
              submitBtn.textContent = 'Adding...';
              resultDiv.innerHTML = '<div class="alert info">Creating instance...</div>';

              try {
                const response = await this.makeAuthenticatedRequest('/api/instances', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(payload)
                });

                const result = await response.json();
                
                if (response.ok) {
                  resultDiv.innerHTML = '<div class="alert success">✅ Instance added successfully!</div>';
                  event.target.reset();
                  await this.loadInstances();
                } else {
                  resultDiv.innerHTML = '<div class="alert error">❌ ' + (result.message || 'Failed to add instance') + '</div>';
                }
              } catch (error) {
                resultDiv.innerHTML = '<div class="alert error">❌ Network Error: ' + error.message + '</div>';
              } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Add Instance';
              }
            }
          }

          document.addEventListener('DOMContentLoaded', () => {
            window.instanceHandler = new GHLUserContextHandler();
          });
        </script>
      </body>
      </html>
    `;
	}
}