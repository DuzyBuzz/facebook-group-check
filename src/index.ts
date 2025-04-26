import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import csv from 'csv-parser';
import ExcelJS from 'exceljs';
import type { Page, Browser } from 'puppeteer';
import { group } from 'console';

puppeteer.use(StealthPlugin());

const randomDelay = () => new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

async function analyzePage(page: Page, url: string) {
    console.log(`🔍 Analyzing: ${url}`);
    try {
        let aboutUrl = url.endsWith('/about') ? url : `${url.replace(/\/$/, '')}/about`;


        await page.goto(aboutUrl, { waitUntil: 'networkidle0', timeout: 100000 });
        

        // Try to close login dialog if it appears
        try {
            const closeButtonSelector = 'div[role="dialog"] div[aria-label="Close"]';
            await page.waitForSelector(closeButtonSelector, { timeout: 5000 });
            await page.click(closeButtonSelector);
        } catch (e) {
            // Dialog didn't appear, ignore
        }

        await randomDelay();


        // ========== Add Random Scroll (Up/Down) ========== 
        await randomScroll(page);

        // ========== Extract Group Name ==========
        let groupName = 'N/A';
        try {
            groupName = await page.$eval('h1.html-h1', el => el.textContent?.trim() || 'N/A');
        } catch (err) {
            console.warn(`⚠️ Page name not found for: ${url}`);
        }
        // ========== Extract Group Classification ==========
        let classification = 'N/A';

        try {
            // Wait until DOM is loaded
            await page.waitForSelector('body');
        
            classification = await page.evaluate(() => {
                const xpath = "//*[contains(text(), 'Public group') or contains(text(), 'Private group')]";
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const node = result.singleNodeValue;
                return node?.textContent?.trim() || 'N/A';
            });
        } catch (err) {
            console.warn(`⚠️ Classification not found for: ${url}`);
        }
        
        
        
        // ========== Extract Member Count ==========
        let memberCount: number | null = null;

        try {
            await page.waitForSelector('body');
        
            memberCount = await page.evaluate(() => {
                // Loop through all span or divs looking for "total members"
                const elements = Array.from(document.querySelectorAll('div, span, li'));
        
                for (const el of elements) {
                    const text = el.textContent?.trim() || '';
        
                    if (/total members/i.test(text)) {
                        // Extract the number from "367,430 total members"
                        const match = text.match(/([\d,]+)\s+total members/i);
                        if (match) {
                            return parseInt(match[1].replace(/,/g, ''), 10);
                        }
                    }
                }
        
                return null;
            });
        } catch (err) {
            console.warn(`⚠️ Exact member count not found in Activity section for: ${url}`);
        }
        
        
        



        // ========== Extract Last Posted Date ==========
        let postsLastMonth: number | null = 0;

        try {
            await page.waitForSelector('body');
        
            postsLastMonth = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('div, span, li'));
        
                for (const el of elements) {
                    const text = el.textContent?.trim() || '';
        
                    // Look for "in the last month" text
                    if (/in the last month/i.test(text)) {
                        const match = text.match(/([\d,]+)\s+in the last month/i);
                        if (match) {
                            return parseInt(match[1].replace(/,/g, ''), 10);
                        }
                    }
                }
        
                return null;
            });
        } catch (err) {
            console.warn(`⚠️ Could not find post count in the last month for: ${url}`);
        }
        
        // ========== Extract Social Media Links by Platform ==========
        let groupLocation: string | null = null;
        let groupCreationDate: string | null = null;
        //let groupNameLastChanged: string | null = null;
        
        try {
            await page.waitForSelector('body');
        
            const groupInfo = await page.evaluate(() => {
                const data = {
                    location: null as string | null,
                    createdOn: null as string | null,
                    nameChangedOn: null as string | null,
                };
        
                const elements = Array.from(document.querySelectorAll('div, span, li'));
        
                for (const el of elements) {
                    const text = el.textContent?.trim() || '';
        
                    if (/group created on/i.test(text)) {
                        const match = text.match(/Group created on (.+?)(?:\.|$)/i);
                        if (match) data.createdOn = match[1];
                    }
        
                    if (/name last changed on/i.test(text)) {
                        const match = text.match(/Name last changed on (.+?)(?:\.|$)/i);
                        if (match) data.nameChangedOn = match[1];
                    }
        
                    if (/^[A-Z][a-z]+(?:,?\s+[A-Z][a-z]+)*$/.test(text) && /philippines/i.test(text)) {
                        // Likely a location: capitalize and contains "Philippines"
                        data.location = text;
                    }
                }
        
                return data;
            });
        
            groupLocation = groupInfo.location;
            groupCreationDate = groupInfo.createdOn;
            //groupNameLastChanged = groupInfo.nameChangedOn;
        
        } catch (err) {
            console.warn(`⚠️ Could not extract group location or history for: ${url}`);
        }



        
        


        let email = '';
        try {
            // Find email using regex search in full text
            const pageText = await page.evaluate(() => document.body.innerText);
            const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            email = emailMatch ? emailMatch[0] : '';
        } catch (err) {
            email = '';
        }
        let username = '';

        try {
            const pageUrl = page.url(); // Get the current URL
            const urlMatch = pageUrl.match(/facebook\.com\/([^/?&]+)/i);
        
            if (urlMatch && urlMatch[1]) {
                username = urlMatch[1];
            } else {
                // Fallback: check in meta tags or page content if URL doesn't help
                const html = await page.content();
        
                // Try from canonical link
                const canonicalMatch = html.match(/<link rel="canonical" href="https:\/\/www\.facebook\.com\/([^/?&"]+)/);
                if (canonicalMatch && canonicalMatch[1]) {
                    username = canonicalMatch[1];
                }
            }
        
            // Optional cleanup if needed
            username = username.replace(/\/$/, ''); // remove trailing slash
        } catch (err) {
            console.warn('⚠️ Could not extract real username');
            username = '';
        }
        

        // ========== Extract Contact Number ==========
        let contactNumber = 'N/A';
        try {
            const pageText = await page.evaluate(() => document.body.innerText);
            const phoneMatch = pageText.match(/(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/);
            contactNumber = phoneMatch ? phoneMatch[0].trim() : 'N/A';
        } catch (err) {
            console.warn(`⚠️ Contact number not found for: ${url}`);
        }
        

        
        // // ========== Extract all anchor tags with hrefs ==========
        // const links = await page.$$eval('a', as => as.map(a => a.href));

        // // ========== Get social media links ==========
        // const baseUrl = page.url();  // Get the base URL of the page for relative URLs
        // let instagram = cleanSocialLink(
        //     links.find(link => link.includes('instagram.com')) || '',
        //     'instagram',
        //     baseUrl
        // );
        // let tiktok = cleanSocialLink(
        //     links.find(link => link.includes('tiktok.com')) || '',
        //     'tiktok',
        //     baseUrl
        // );
        // let youtube = cleanSocialLink(
        //     links.find(link => link.includes('youtube.com')) || '',
        //     'youtube',
        //     baseUrl
        // );
        // let twitter = cleanSocialLink(
        //     links.find(link => link.includes('twitter.com') || link.includes('x.com')) || '',
        //     'x',
        //     baseUrl
        // );

        // // Try to get the links if they weren't found earlier
        // try {
        //     const allLinks = await page.$$eval('a[href]', anchors =>
        //         anchors.map(a => a.href.toLowerCase())
        //     );

        //     for (const link of allLinks) {
        //         if (!instagram && link.includes('instagram.com')) instagram = link;
        //         if (!tiktok && link.includes('tiktok.com')) tiktok = link;
        //         if (!youtube && link.includes('youtube.com')) youtube = link;
        //         if (!twitter && link.includes('twitter.com')) twitter = link;
        //     }
        // } catch (err) {
        //     // Leave blank if error occurs
        // }
        




        // ========== Determine Group Status ==========
        const isActive = postsLastMonth !== null ? isPostRecent(postsLastMonth) : false;
        const pageStatus = isActive ? 'Active' : 'Not Active';

        console.log(`✅ Done analyzing: ${url}`);
        return {
            LINK: url,
            USERNAME: username,
            GROUP_NAME: groupName,
            MEMBER: memberCount,
            CLASSIFICATION: classification,
            POST_LAST_MONTH: postsLastMonth,
            LOCATION: groupLocation,
            DATE_JOINED: groupCreationDate,
            //PAGE_HISTORY: groupNameLastChanged,
            EMAIL_URL: email,
            CONTACT_NUMBER: contactNumber,
            // INSTAGRAM_URL: instagram,
            // TIKTOK_URL: tiktok,
            // YOUTUBE_URL: youtube,
            // X_URL: twitter,
            PAGE_STATUS: pageStatus

        };
        
    } catch (err) {
        console.error(`❌ Failed to analyze ${url}:`, err);
        return {
            LINK: url,
            PAGE_NAME: 'Error',
            FOLLOWERS: 'Error',
            PAGEDETAILS: 'Error',
            LAST_POSTED: 'Error',
            PAGE_STATUS: 'Error'
        };
    }
}
function cleanSocialLink(link: string, platform: string, baseUrl: string): string {
    if (link.startsWith('/')) {
        // Handle relative URLs by appending the base URL
        link = new URL(link, baseUrl).href;
    }

    // If the link is obfuscated (e.g., starts with '@l.php'), you might want to clean it
    if (link.includes('@l.php')) {
        // Extract the actual URL, or you can try to process the obfuscated link here
        // For now, just return an empty string if it's obfuscated
        console.warn(`Obfuscated link found for ${platform}: ${link}`);
        return '';
    }

    return link;
}


// Random Scroll Function
async function randomScroll(page: Page) {
    const scrollTimes = 5; // Number of scrolls (10 scrolls)
    const minScrollDelay = 1000; // Minimum delay between scrolls (2 seconds)
    const maxScrollDelay = 2000; // Maximum delay between scrolls (5 seconds)

    for (let i = 0; i < scrollTimes; i++) {
        const direction = Math.random() > 0.5 ? 1 : -1; // Random direction: up or down
        const distance = Math.floor(Math.random() * 300) + 100; // Scroll distance (100px to 400px)

        await page.evaluate((direction, distance) => {
            window.scrollBy({
                top: direction * distance,
                behavior: 'smooth'
            });
        }, direction, distance);

        const delay = Math.floor(Math.random() * (maxScrollDelay - minScrollDelay) + minScrollDelay);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

function isPostRecent(postsLastMonth: number): boolean {
    if (postsLastMonth === 0) {
        return false; // No posts, group is not active
    }
    return true; // Posts present, group is active
}
  
  
  
  
  
  


/**
 * Converts follower string like "1.2K", "3M", etc. to a real number string
 */
function convertFollowers(value: string): string {
    if (!value) return '0';

    const match = value.trim().match(/^([\d.]+)([KM]?)$/i);
    if (!match) return value;

    const number = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();

    switch (suffix) {
        case 'K':
            return Math.round(number * 1000).toString();
        case 'M':
            return Math.round(number * 1_000_000).toString();
        default:
            return Math.round(number).toString();
    }
}




async function main() {
    const links: string[] = [];
    

    // Step 1: Read from CSV
    console.log('📥 Reading CSV file...');
    await new Promise<void>((resolve, reject) => {
        fs.createReadStream('link.csv')
            .pipe(csv())
            .on('data', (row) => {
                if (row.URL) links.push(row.URL);
            })
            .on('end', () => {
                console.log(`📄 Total URLs loaded: ${links.length}`);
                resolve();
            })
            .on('error', (err) => {
                console.error('❌ Failed to read CSV:', err);
                reject(err);
            });
    });

    // Step 2: Setup Puppeteer
    console.log('🚀 Launching browser...');
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
        ],
        defaultViewport: null
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setJavaScriptEnabled(true);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    console.log('🔄 Starting analysis on all pages...');
    // Step 3: Loop and collect data
    const results = [];
    const failedLinks: string[] = []; // Track failed links
    for (const [index, link] of links.entries()) {
        console.log(`\n📌 (${index + 1}/${links.length}) Processing: ${link}`);
        const data = await analyzePage(page, link);
    
        // ✅ Convert followers string to numeric format
        if (data.FOLLOWERS && data.FOLLOWERS !== 'N/A' && data.FOLLOWERS !== 'Error') {
            data.FOLLOWERS = convertFollowers(data.FOLLOWERS);
        }
    
        results.push(data);
    
        // Track failed pages
        if (data.PAGE_NAME === 'Error') {
            failedLinks.push(link);
        }
    }
    
    await browser.close();
    console.log('🛑 Browser closed.');

    // Step 4: Export to Excel
    console.log('📊 Exporting data to Excel...');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Facebook Pages');

    const headerStyle = {
        font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 14, name: 'Calibri' },
        fill: {
            type: 'gradient',
            gradient: 'angle',
            stops: [
                { position: 0, color: { argb: 'FF1F4E78' } }, // Dark blue
                { position: 1, color: { argb: 'FF3E73A8' } }, // Light blue gradient
            ],
        },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: {
            top: { style: 'thick', color: { argb: 'FF000000' } },
            left: { style: 'thick', color: { argb: 'FF000000' } },
            bottom: { style: 'thick', color: { argb: 'FF000000' } },
            right: { style: 'thick', color: { argb: 'FF000000' } }
        }
    };
    
    const cellStyle = {
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        font: { name: 'Calibri', size: 12 },
        border: {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        }
    };
    
    // Add shading to every other row to improve readability
    const alternatingRowStyle = {
        fill: {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F2F2' } // Light gray background for alternating rows
        }
    };
    
    // Apply larger, bold fonts to page names and important columns
    const pageNameStyle = {
        font: { bold: true, size: 13 },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        }
    };
    
    // Styling the header row
    sheet.columns = [
        { header: 'GROUP NAME', key: 'GROUP_NAME', width: 40, outlineLevel: 1 },
        { header: 'LINK', key: 'LINK', width: 50, outlineLevel: 1 },
        { header: 'MEMBER', key: 'MEMBER', width: 20, outlineLevel: 1 },
        { header: 'CLASSIFICATION', key: 'CLASSIFICATION', width: 30, outlineLevel: 1 },
        { header: 'LOCATION', key: 'LOCATION', width: 40 },
        { header: 'DATE JOINED', key: 'DATE_JOINED', width: 40 },
        //{ header: 'PAGE HISTORY', key: 'PAGE_HISTORY', width: 40 },
        { header: 'EMAIL URL', key: 'EMAIL_URL', width: 35 },
        // { header: 'CONTACT NUMBER', key: 'CONTACT_NUMBER', width: 25 },
        // { header: 'INSTAGRAM URL', key: 'INSTAGRAM_URL', width: 50 },
        // { header: 'TIKTOK URL', key: 'TIKTOK_URL', width: 50 },
        // { header: 'YOUTUBE URL', key: 'YOUTUBE_URL', width: 50 },
        // { header: 'X URL', key: 'X_URL', width: 50 },
        { header: 'POST LAST MONTH', key: 'POST_LAST_MONTH', width: 25, outlineLevel: 1 },
        { header: 'PAGE STATUS', key: 'PAGE_STATUS', width: 20, outlineLevel: 1 }

    ];
    
    
    // Apply header style
    sheet.getRow(1).eachCell((cell) => {
        Object.assign(cell, headerStyle);
    });
    
    // Add the rows with alternating row styles and custom cell styling
    results.forEach((rowData, rowIndex) => {
        const row = sheet.addRow(rowData);
    
        // Apply alternating row color style
        if (rowIndex % 2 === 0) {
            row.eachCell((cell) => {
                Object.assign(cell, alternatingRowStyle);
            });
        }
    
        // Apply standard cell style
        row.eachCell((cell: any, colIndex: number) => {
            // Special style for the Page Name column
            if (colIndex === 1) {
                Object.assign(cell, pageNameStyle);
            } else {
                Object.assign(cell, cellStyle);
            }
        });
    
        // Highlight status with colors
// Highlight status with colors
const statusCell = row.getCell('PAGE_STATUS');
if (rowData.PAGE_STATUS === 'Active') {
    statusCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF92D050' } // green
    };
} else if (rowData.PAGE_STATUS === 'Not Active') {
    // 🔥 Make sure all cells exist and apply red fill
    for (let i = 1; i <= sheet.columns.length; i++) {
        const cell = row.getCell(i);
        cell.value = cell.value || ''; // Ensure the cell exists even if it's empty
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFF5C5C' } // red
        };
    }
}

    });
    
    // ⬇️ This should be **after** results.forEach (outside it)
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const year = now.getFullYear();
    let hours = now.getHours();
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    
    const timestamp = `${month}-${day}-${year}_${pad(hours)}-${minutes}-${seconds}_${ampm}`;
    const fileName = `Facebook_Pages_${timestamp}.xlsx`;
    
    await workbook.xlsx.writeFile(fileName);
    console.log(`✅ Excel file saved as: ${fileName}`);
    
    // Step 5: Log failed links (if any)
    if (failedLinks.length > 0) {
        console.log(`⚠️ ${failedLinks.length} pages failed to analyze. Writing to failed_links.txt...`);
        fs.writeFileSync('failed_links.txt', failedLinks.join('\n'), 'utf-8');
    } else {
        console.log('🎉 All pages processed successfully without errors.');
    }
    
    console.log('🏁 Done.');
    
 }
 
 main().catch(err => {
     console.error('❌ Unexpected error in main():', err);
 });
 
