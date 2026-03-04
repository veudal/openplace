import { Component, OnInit, isDevMode } from '@angular/core';
import Pickr from '@simonwep/pickr';
import { Pixel } from '../models/Pixel.model';
import { HoverPixel } from '../models/HoverPixel';
import { environment } from '../../environments/environment';
import { BoardSize } from '../interfaces/BoardSize.interface';
import { Leaderboard } from '../interfaces/Leaderboard.interface';
import { SignalRService } from '../services/signalr.service';
import { ViewSettings } from '../interfaces/ViewSettings.interface';
import { HubConnectionState } from '@microsoft/signalr';
import Panzoom, { PanzoomObject } from '@panzoom/panzoom';
import { ActivatedRoute, Params, QueryParamsHandling, Router, RouterLink, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NgxSliderModule } from '@angular-slider/ngx-slider';
import moment from 'moment';
import 'moment/min/locales';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterOutlet, CommonModule, RouterLink, NgxSliderModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})

export class HomeComponent implements OnInit {
  title: string = 'Open Place';

  colorPalette: string[] = ['000000', 'FFFFFF', 'B9C3CF', '777F8C', '424651', '1F1E26', '000000', '382215', '7C3F20', 'C06F37', 'FEAD6C', 'FFD2B1', 'FFA4D0',
    'F14FB4', 'E973FF', 'A630D2', '531D8C', '242367', '0334BF', '149CFF', '8DF5FF', '01BFA5', '16777E', '054523', '18862F',
    '61E021', 'B1FF37', 'FFFFA5', 'FDE111', 'FF9F17', 'F66E08', '550022', '99011A', 'F30F0C', 'FF7872'];

  defaultColor: string = "FFFFFF";
  defaultUsername: string = "Anonymous";
  username: string = this.defaultUsername;
  id: string = "";
  takenColors: Map<string, string> = new Map();
  mentionCount = 0;
  isChatHiddenByScript = false;

  timeoutId: number | null = null;
  audio: HTMLAudioElement = new Audio("assets/sfx/place.mp3");
  pickr: Pickr | null = null;

  hoverPixel: HoverPixel = new HoverPixel(-1, -1, "", "");
  boardArr: Pixel[] = [];
  userFilter: string | null = null;
  pixelQueue: Pixel[] = [];
  dimensions: BoardSize = { height: 20, width: 20 };
;
  panzoom: PanzoomObject = null!;
  leaderboard: Leaderboard[] = [];
  progress: string = "0.00 MB fetched...";
  pixelEstimate: string = "(0 pixels)";
  userCount = 0;
  charCount = 0;
  maxMessageLength = 0;
  maxUsernameLength = 0;

  selectedColor: number = 0;

  debounceTimeout: any = null;
  panzoomRouting = false;

  sliderValue = 0;
  sliderDragState = false;
  isBoardLoaded = false;
  sliderGradient = {
    from: 'skyblue',
    to: '#8048fa'
  }
  sliderOptions = {
    ceil: 0,
    vertical: true,
    showSelectionBar: true,
    rightToLeft: true,
    selectionBarGradient: this.sliderGradient,
    getPointerColor: () => {
      return '#8048fa';
    },
    translate: (value: number): string => {
      if (value == 0) {
        return `
      <div style="text-align: center; color: #8048fa; font-size: 14px">
        <b># ${value} Pixel
      </div>`;
      }

      const p = this.boardArr[Math.max(value - 1, 0)];

      // Shorten name if nessecary
      const maxLength = 8;
      const name = p.p && p.p.length > maxLength ? `${p.p.substring(0, maxLength - 1)}..` : p.p;

      return `
      <div style="text-align: center; color: #8048fa; font-size: 14px">
        <b># ${value} Pixel
        </b><br>${this.getLocalDate(p.t)}
        </b><br>(${p.x} | ${p.y}) @${name}
    </div>`;
    }
  };

  grid: any;
  canvas: any;
  context: any;


  constructor(private signalRService: SignalRService, private router: Router, private route: ActivatedRoute) { }

  async ngOnInit() {
    await this.initConfiguration();
    this.initCanvas();
    this.initUsernameAndID();
    this.initPanzoom();
    this.initCanvasEvents();
    this.initSignalR();
    this.initDocumentEvents();
    this.initPaletteContainer();
    this.initColorPicker();
    this.initLocale();
    this.initSliderUpdate();
  }

  private initSliderUpdate() {
    // This method is needed in order to update the relative time info on the slider
    setInterval(() => {
      const currentValue = this.sliderValue;
      this.sliderValue = currentValue + 1;

      setTimeout(() => {
        this.sliderValue = currentValue;
      }, 100);
    }, 30000); // Update every 30 seconds
  }

  private async initConfiguration() {
    await fetch(environment.endpointUrl + "/Config")
      .then(response => response.json())
      .then(data => {
        this.userCount = data.onlineUsersCount + 1;
        this.maxMessageLength = data.maxMessageLength;
        this.maxUsernameLength = data.maxUsernameLength;
        environment.boardHeight = data.boardHeight;
        environment.boardWidth = data.boardWidth;
        this.dimensions = { width: environment.boardWidth, height: environment.boardHeight }
        this.restoreLast20Messages(data.messages);
      })
      .catch((response) => {
        if (!response.ok) {
          alert("This site is currently under maintenance.");
        }
      });
  }

  private restoreLast20Messages(messages: any) {
    for (var i = 0; i < messages.length; i++) {
      const message = messages[i];
      this.receiveChatMessage(message.timestamp, message.userId, message.username, message.message);
    }
  }

  private initLocale() {
    const userLocale = navigator.language
      ? navigator.languages[0]
      : navigator.language || 'en';
    moment.locale(userLocale);
  }

  private initUsernameAndID() {
    const storedUsername = localStorage.getItem("username");
    if (storedUsername) {
      this.username = storedUsername;
    }

    const storedID = localStorage.getItem("id");
    if (storedID) {
      this.id = storedID;
    }
    else {
      const uniqueString = Math.random().toString(36).substring(2, 9);
      localStorage.setItem("id", uniqueString);
      this.id = uniqueString;
    }
  }

  private initPanzoom() {
    this.panzoom = Panzoom(this.canvas, {
      contain: 'outside',
      cursor: 'pointer',
      step: 0.7,
      minScale: 1.000001, // No rounding to avoid visual glitches
      maxScale: Math.min(this.dimensions.width, this.dimensions.height) / 10,
      touchAction: ""
    });
    this.restorePanzoomState();
    this.route.queryParams.subscribe((params) => this.updatePanZoomFromParams(params))
  }

  private initColorPicker() {
    this.pickr = Pickr.create({
      el: '.color-picker',
      theme: 'monolith',
      useAsButton: true,
      position: "bottom-start",
      autoReposition: true,
      default: this.colorPalette[0],
      swatches: this.colorPalette.slice(2),
      lockOpacity: true,

      components: {

        preview: true,
        opacity: false,
        hue: true,
        
        interaction: {
          hex: true,
          rgba: true,
          cancel: false,
          input: true,
          clear: false,
          save: false
        }
      }
    });

    this.pickr.on("hide", () => {
      this.pickr?.applyColor();
      if (this.isChatHiddenByScript) {
        const div = document.getElementById("chat-container") as HTMLDivElement;
        div.classList.remove("hidden");
        this.isChatHiddenByScript = false;
      }
    })

    this.pickr.on('change', (color: any) => {
      const hexa = color.toHEXA();
      const c = hexa[0] + hexa[1] + hexa[2];
      this.updatePaletteSelection(c);
    });
  }

  private async initCanvas() {
    // Initialize canvas
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.canvas.width = this.dimensions.width;
    this.canvas.height = this.dimensions.height;

    this.context = this.canvas.getContext("2d");
    this.canvas.setAttribute('tabindex', '0');

    this.grid = document.getElementById('grid') as HTMLDivElement;
    await this.loadBoard();
  }

  private initCanvasEvents() {
    this.canvas.addEventListener('wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('keydown', (e: KeyboardEvent) => this.handleKeydown(e));
    this.canvas.addEventListener('pointerdown', (e: MouseEvent) => this.handleMouseDown(e));
    this.canvas.addEventListener('pointerup', (e: MouseEvent) => this.handleMouseUp(e));
    this.canvas.addEventListener("pointermove", this.onHover.bind(this));
    this.canvas.addEventListener("pointerleave", this.onLeave.bind(this));
    this.canvas.addEventListener('pointerover', () => this.handleMouseOver());
  }

  private handleMouseOver() {
    if (!this.sliderDragState && !this.pickr?.isOpen()) {
      this.canvas.focus()
    }
  }

  private initPaletteContainer() {
    const storedColor = localStorage.getItem("customColor");
    if (storedColor !== null) {
      this.colorPalette[0] = storedColor;
    }

    const paletteContainer = document.getElementById('palette-container');
    if (!paletteContainer) return;

    this.colorPalette.forEach((color, i) => {
      const colorDiv = document.createElement('div') as HTMLDivElement;

      // First color (larger, aligned to the left)
      if (i == 0) {
        colorDiv.style.width = '60px';
        colorDiv.style.height = '60px';
        colorDiv.style.position = 'absolute';
        colorDiv.style.top = '23%';
        colorDiv.style.left = '3%';    
      }
      // Remaining colors (normal grid)
      else {
        colorDiv.style.width = '35px';
        colorDiv.style.height = '35px';
        colorDiv.style.marginLeft = '50px';
      }

      colorDiv.style.backgroundColor = `#${color}`;
      colorDiv.style.borderRadius = '20%';
      colorDiv.style.cursor = 'pointer';
      colorDiv.style.transition = 'transform 0.2s ease';
      colorDiv.style.border = '2px solid #ffffff';
      colorDiv.id = i.toString() + "-color";

      if (i == this.selectedColor) {
        colorDiv.style.transform = 'scale(1.3)';
        colorDiv.style.border = '3px solid #0080FF';
      }


      colorDiv.addEventListener('click', () => this.handleColorDivClick(colorDiv));
      colorDiv.addEventListener('mouseover', () => colorDiv.style.transform = 'scale(1.3)');
      colorDiv.addEventListener('mouseout', () => colorDiv.style.transform = 'scale(1)');

      paletteContainer.appendChild(colorDiv);
    });
  }

  private handleColorDivClick(colorDiv: HTMLDivElement) {
    const index = parseInt(colorDiv.id.substring(0, colorDiv.id.indexOf('-')));
    this.updatePaletteSelection(null, index);

    if (this.selectedColor == 0) {
      const div = document.getElementById("chat-container") as HTMLDivElement;
      if (!div.classList.contains("hidden")) {
        div.classList.add("hidden");
        this.isChatHiddenByScript = true;
      }
      this.pickr?.show();
    }
  }

  private async initSignalR() {

    this.signalRService.startConnection().subscribe(() => {

      this.signalRService.receivePixel().subscribe((p: any) => {
        const pixel = JSON.parse(p);
        this.receivePixel(pixel);
      });

      this.signalRService.receiveMessage().subscribe(([timestamp, userId, username, message]) => {
        this.receiveChatMessage(timestamp, userId, username, message);
      });

      this.signalRService.receiveBroadcast().subscribe(([username, info]) => {
        if (username.toLowerCase() == this.username.toLowerCase()) {
          alert("Admin: " + info)
        }
      });

      this.signalRService.receiveUserCount().subscribe((count: number) => {
        this.userCount = count;
      });
    })
  }

  public onMouseOver() {
    document.title = this.title;
    this.mentionCount = 0;
  }

  private getAllIndices(str: string, substring: string) {
    const regex = new RegExp('\\b' + substring, 'gi');
    return [...str.matchAll(regex)].map(match => match.index);
  }

  public chatInputChange(event: Event) {
    const inputElement = event.target as HTMLTextAreaElement;
    this.charCount = inputElement.value.length;
  }

  private dateDiffInDays(a: Date, b: Date): number {
    const date1 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const date2 = new Date(b.getFullYear(), b.getMonth(), b.getDate());

    const timeDifference = Math.abs(date1.getTime() - date2.getTime());
    const msPerDay = 24 * 60 * 60 * 1000;

    return Math.ceil(timeDifference / msPerDay);
  }

  private receiveChatMessage(timestamp: Date, userId: string, username: string, message: string) {
    const container = document.getElementById("chat-messages")!;
    const messageElement = document.createElement("div");
    const timeSpan = document.createElement("span");
    const usernameSpan = document.createElement("span");
    const messageSpan = document.createElement("span");

    let content;
    const date = new Date(timestamp);
    const difference = this.dateDiffInDays(new Date(), date);

    if (difference == 0) {
      content = date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0");
    }
    else if (difference == 1) {
      content = "Yesterday";
    }
    else {
      return;
    }

    timeSpan.textContent = content + " - ";
    timeSpan.style.color = "gray";
    timeSpan.classList.add('disable-selection');

    usernameSpan.textContent = username + ": ";
    usernameSpan.style.fontWeight = "700";
    usernameSpan.style.color = this.getUsernameColor(userId);
    usernameSpan.style.cursor = "pointer";
    usernameSpan.classList.add('disable-selection');

    usernameSpan.addEventListener("pointerdown", () => {
      const message = document.getElementById("chat-input") as HTMLInputElement;
      const prefix = message.value.length == 0 ? "@" : " @";
      message.value += prefix + username;
      this.charCount = message.value.length;
    });


    // Find and style mention in the message
    const pingRegex = /(?<!\S)@([a-zA-Z0-9]+)(?![a-zA-Z0-9])/g;
    const audio = new Audio("assets/sfx/notification.mp3");

    const formattedMessage = message.replace(pingRegex, (match) => {
      const gotMentioned = match.substring(1) == this.username;
      if (gotMentioned) {
        messageElement.style.backgroundColor = "#FFDDDB"

        if (this.signalRService.getState() == "Connected") { //Only play sound when message was received via hub, not from server message history
          audio.play();
        }

        const targetDiv = document.getElementById('chat-container');
        if (targetDiv != document.activeElement && !targetDiv?.contains(document.activeElement)) {
          this.mentionCount++;
          const plural = this.mentionCount - 1 ? "s" : "";
          document.title = `Open Place (${this.mentionCount} mention${plural})`;
        }
      }
      const color = gotMentioned ? "red" : "blue";
      return `<span style="font-weight: 600; color: ${color}">${match}</span>`;
    });
    messageSpan.innerHTML = formattedMessage;
    messageElement.appendChild(timeSpan);
    messageElement.appendChild(usernameSpan);
    messageElement.appendChild(messageSpan);

    messageElement.style.fontSize = "18px";
    messageElement.style.padding = "5px";
    messageElement.style.margin = "5px 0";
    messageElement.style.borderRadius = "5px";

    // Append the message element to the container and scroll to the bottom
    container.appendChild(messageElement);
    container.scrollTop = container.scrollHeight;
  }


  //private highlightMentions(element: HTMLElement): void {
  //  const pingRegex = /(?<!\S)@([a-zA-Z0-9]+)/g;

  //  // Save the current selection and cursor position
  //  const sel = window.getSelection();
  //  const range = sel!.rangeCount > 0 ? sel!.getRangeAt(0) : null;
  //  const currentOffset = range ? range.startOffset : 0;

  //  // Create a temporary div to hold the formatted content
  //  const tempDiv = document.createElement('div');
  //  let lastIndex = 0;
  //  let match: RegExpExecArray | null;

  //  // Replace mentions while preserving other text
  //  while ((match = pingRegex.exec(element.innerText)) !== null) {
  //    // Append text before the mention
  //    tempDiv.appendChild(document.createTextNode(element.innerText.substring(lastIndex, match.index)));

  //    // Create a span for the mention
  //    const mentionSpan = document.createElement('span');
  //    mentionSpan.style.fontWeight = '600';
  //    mentionSpan.style.color = 'blue';
  //    mentionSpan.textContent = match[0]; // Use the matched mention
  //    tempDiv.appendChild(mentionSpan);

  //    lastIndex = match.index + match[0].length;
  //  }

  //  // Append any remaining text after the last mention
  //  tempDiv.appendChild(document.createTextNode(element.innerText.substring(lastIndex)));

  //  // Clear the original element and append the new content
  //  element.innerHTML = ''; // Clear using innerHTML for better performance
  //  element.appendChild(tempDiv);

  //  // Restore the cursor position
  //  if (sel && range) {
  //    const newRange = document.createRange();
  //    let adjustedOffset = currentOffset;

  //    // Find the new cursor position
  //    tempDiv.childNodes.forEach((child) => {
  //      if (child.nodeType === Node.TEXT_NODE) {
  //        if (adjustedOffset <= child.textContent!.length) {
  //          newRange.setStart(child, adjustedOffset);
  //          newRange.collapse(true);
  //          return; // Exit the forEach loop early
  //        }
  //        adjustedOffset -= child.textContent!.length;
  //      } else if (child.nodeType === Node.ELEMENT_NODE) {
  //        const spanLength = child.textContent!.length;
  //        if (adjustedOffset <= spanLength) {
  //          newRange.setStartAfter(child);
  //          newRange.collapse(true);
  //          return; // Exit the forEach loop early
  //        }
  //        adjustedOffset -= spanLength;
  //      }
  //    });

  //    // Adjust the range to the appropriate position if needed
  //    if (adjustedOffset > 0) {
  //      newRange.setStart(tempDiv, tempDiv.childNodes.length); // Set to the end if out of bounds
  //    }

  //    // Restore the selection
  //    sel.removeAllRanges();
  //    sel.addRange(newRange);
  //  }
  //}

  public chatInputKeydown(event: KeyboardEvent) {
    if (event.key == 'Enter') {
      event.preventDefault(); //Do not allow multiple lines
      this.sendChatMessage();
    }
  }

  public chatArrowClick() {
    const div = document.getElementById("chat-container") as HTMLDivElement;
    div.classList.toggle("hidden");
  }

  private getUsernameColor(id: string) {
    const colors = ["#DC143C", "#4169E1", "#3CB371", "#DAA520", "#6A5ACD", "#FF6347", "#FF8C00",
      "#9370DB", "#008080", "#4682B4", "#9932CC", "#FF7F50", "#228B22", "#FF1493", "#708090"];

    if (this.takenColors.has(id)) {
      return this.takenColors.get(id)!;
    }

    // Delete the first entry if all colors are taken
    if (this.takenColors.size == colors.length) {
      const firstKey = this.takenColors.keys().next().value;
      if (firstKey !== undefined) {
        this.takenColors.delete(firstKey); // NEW CHANGE
      }
    }

    const availableColors = colors.filter(color => !Array.from(this.takenColors.values()).includes(color));

    let sum = 0;
    for (var i = 0; i < id.length; i++) {
      sum += id.charCodeAt(i);
    }

    const color = availableColors[sum % availableColors.length];
    this.takenColors.set(id, color);

    return color;
  }

  public async sendChatMessage() {

    const message = document.getElementById("chat-input") as HTMLInputElement;
    const input = message.value;

    //Check for empty input
    if (!input.trim()) {
      return;
    }
    else if (input.length > this.maxMessageLength) {
      return;
    }
    message.value = "";
    this.charCount = 0;

    const result = await fetch(environment.endpointUrl + "/Message", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: this.username, message: input, userId: this.id })
    });

    if (result.status === 429) {
      message.value = input;
      this.charCount = input.length;

      this.waitForNextFrame().then(() => alert(`Wait ${result.headers.get("retry-after")} seconds before sending a message.`));
    }
    else if (!result.ok) {
      message.value = input;
      this.charCount = input.length;

      const response = await result.text();

      //Check for empty response
      if (response.trim()) {
        this.waitForNextFrame().then(() => alert(response));
      }
    }

  }

  private waitForNextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  private receivePixel(receivedPixel: any) {
    if (receivedPixel.p == "") {
      receivedPixel.p = this.defaultUsername;
    }

    this.boardArr.push(receivedPixel);

    const isLastPixel = this.sliderValue + 1 == this.boardArr.length;

    if (this.isBoardLoaded && isLastPixel && this.userFilter == null) {
      this.setSliderToMax();
    }
    else {
      this.sliderOptions = {
        ...this.sliderOptions,
        ceil: this.boardArr.length
      };
    }
    if (isLastPixel && !this.userFilter || this.userFilter == receivedPixel.p) {
      this.drawPixel(receivedPixel.x, receivedPixel.y, receivedPixel.c);
    }

    this.updateLeaderboard();
  }

  private initDocumentEvents() {
    document.addEventListener('wheel', (e: WheelEvent) => this.handleColorScrolling(e), { passive: false });
    document.addEventListener("contextmenu", (e: Event) => e.preventDefault());

    document.addEventListener('selectionchange', () => {
      if (document.activeElement?.id == "canvas") {
        window.getSelection()!.removeAllRanges();
      }
    });

    document.addEventListener('pointerup', (e: MouseEvent) => {
      if (e.button == 2) {
        this.savePanzoomState();
      }
    });
  }

  private handleColorScrolling(e: WheelEvent) {
    const id = (e.target as HTMLElement).id
    if (e.shiftKey || e.ctrlKey || e.altKey || id == "palette-container" || id.endsWith("-color")) {
      e.preventDefault()
      if (e.deltaY > 0) {
        this.changeColorSelection("E");
      }
      else {
        this.changeColorSelection("Q");
      }
    }
  }

  private handleMouseUp(e: MouseEvent) {

    if (e.button == 1 || e.button == 2) {
      const pan = this.panzoom.getPan();
      const stored: ViewSettings = JSON.parse(localStorage.getItem("panzoomState") || "{}");

      const tolerance = 0.5;

      const xMatch = Math.abs(pan.x - stored.x) <= tolerance;
      const yMatch = Math.abs(pan.y - stored.y) <= tolerance;
      if (xMatch && yMatch) {
        this.colorPicker(e);
      }
    }
    else if (e.button == 0 && this.sliderDragState == false) {
      this.setPixel(e);
    }
  }

  private handleMouseDown(e: MouseEvent) {
    this.panzoom.setOptions({ disablePan: e.button != 2 });
    this.pickr?.hide();
  }

  private handleKeydown(e: KeyboardEvent) {
    if (this.pickr?.isOpen()) {
      return;
    }

    this.handleMovement(e);

    this.changeColorSelection(e.key.toUpperCase());

    if (e.code.startsWith("Digit")) {
      const key = e.code.slice(5);
      let index = 9;
      if (key != '0') {
        index = parseInt(key) - 1;
      }
      if (this.userFilter == this.leaderboard[index].name) {
        this.resetUserFilter();
        return;
      }
      this.userFilter = this.leaderboard[index].name;
      this.updateLeaderboard();
      this.drawBoard();
      this.hoverPixel = this.findLatestPixel(this.hoverPixel.x, this.hoverPixel.y) || new HoverPixel(-1, -1, "", "");
    }
    else if (e.key == "Escape") {

      this.resetUserFilterAndHistoryMode();
    }
    else if (e.key == "+") {
      this.panzoom.zoomIn();
      this.savePanzoomState();
    }
    else if (e.key == "-") {
      this.panzoom.zoomOut();
      this.savePanzoomState();
    }
    else if (e.key.toUpperCase() == "G") {
      if (isDevMode()) {
        if (this.grid.style.opacity == 0) {
          this.grid.style.opacity = 1;
        }
        else {
          this.grid.style.opacity = 0;
        }
      }
    }
  }

  private changeColorSelection(key: string) {
    let index = this.selectedColor;
    if (key == " ") {
      index = 0;
    }
    else if (key == "Q") {
      index = Math.max(0, this.selectedColor - 1);
    }
    else if (key == "E") {
      index = Math.min(this.colorPalette.length - 1, this.selectedColor + 1);
    }
    else {
      return;
    }

    this.updatePaletteSelection(null, index);
    this.drawHoverPixel(this.hoverPixel?.x ?? 0, this.hoverPixel?.y ?? 0, this.hoverPixel?.c ?? this.defaultColor, this.hoverPixel.p, true);
    this.pickr?.hide();
  }

  private resetUserFilter() {
    this.userFilter = null;
    this.updateLeaderboard();
    this.drawBoard();
    this.hoverPixel = this.findLatestPixel(this.hoverPixel.x, this.hoverPixel.y) || new HoverPixel(-1, -1, "", "");
  }

  private updatePaletteSelection(c: string | null, index: number | null = null) {

    const old = document.getElementById(this.selectedColor.toString() + "-color")!;
    old.style.border = '2px solid #ffffff';
    old.style.transform = 'scale(1.0)';

    if (c) {
      c = c.toUpperCase();
      this.selectedColor = Math.max(this.colorPalette.lastIndexOf(c), 0);
    }
    else if (index != null) {
      this.selectedColor = index;
    }

    const colorDiv = document.getElementById(this.selectedColor.toString() + "-color")!;
    colorDiv.style.border = '3px solid #0080FF';
    colorDiv.style.transform = 'scale(1.3)';

    if (this.selectedColor == 0) {
      if (c) {
        this.colorPalette[0] = c.toUpperCase();
      }
      else if (index) {
        this.colorPalette[0] = this.colorPalette[index]
      }
      colorDiv.style.backgroundColor = "#" + c;
      localStorage.setItem("customColor", this.colorPalette[0]);
    }
  }

  private colorPicker(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = this.calculateXPosition(e.clientX, rect);
    const y = this.calculateYPosition(e.clientY, rect);
    let pixel = this.findLatestPixel(x, y);
    if (!pixel) {
      if (x < this.dimensions.width && y < this.dimensions.height) {
        pixel = new Pixel(x, y, this.defaultColor, "", "");
      }
      else {
        return;
      }
    }
    this.updatePaletteSelection(pixel.c);
    if (this.selectedColor == 0) {
      this.pickr?.setColor("#" + pixel.c);
    }
    this.drawHoverPixel(this.hoverPixel.x, this.hoverPixel.y, this.hoverPixel?.c ?? this.defaultColor, this.hoverPixel.p, true);
  }
  private handleMovement(e: KeyboardEvent) {
    switch (e.key.toLocaleLowerCase()) {
      case "w":
      case "arrowup":
        this.move(0, 1);
        break;

      case "a":
      case "arrowleft":
        this.move(1, 0);
        break;

      case "s":
      case "arrowdown":
        this.move(0, -1);
        break;

      case "d":
      case "arrowright":
        this.move(-1, 0);
        break;
    }
  }

  private move(deltaX: number, deltaY: number) {

    const pan = this.panzoom.getPan();
    const zoom = this.panzoom.getScale();

    const panX = pan.x + deltaX * this.canvas.clientWidth / (zoom * 2);
    const panY = pan.y + deltaY * this.canvas.clientHeight / (zoom * 2);

    this.panzoom.pan(panX, panY, { animate: true, force: true });

    const pixel = this.findLatestPixel(this.hoverPixel.x, this.hoverPixel.y);
    if (pixel) {
      this.drawPixel(pixel.x, pixel.y, pixel.c);
    }
    this.savePanzoomState();
  }

  private resetUserFilterAndHistoryMode() {

    this.setSliderToMax();
    this.sliderValue = this.sliderOptions.ceil; //Required because drawBoard will be exectued before setSliderToMax due to setTimeout otherwise slider would glitch
    this.setSliderColor();
    this.resetUserFilter();
  }

  private setSliderColor() {
    const alternativeGradient = { from: 'orange', to: 'red' };

    this.sliderOptions = {
      ...this.sliderOptions,
      selectionBarGradient: this.sliderValue == this.boardArr.length ? this.sliderGradient : alternativeGradient
    };
  }

  private setPixel(e: MouseEvent) {
    if (!this.sliderDragState && (this.sliderValue != this.sliderOptions.ceil || this.userFilter != null)) {
      this.resetUserFilterAndHistoryMode();
      //Exit history mode
      return;
    }


    const rect = this.canvas.getBoundingClientRect();
    const x = this.calculateXPosition(e.clientX, rect);
    const y = this.calculateYPosition(e.clientY, rect);
    const pixel = this.getValidPixelOrNull(x, y, this.colorPalette[this.selectedColor], this.username, new Date());

    if (pixel) {
      this.hoverPixel = pixel;
      this.drawPixel(pixel.x, pixel.y, pixel.c);
      this.sendPixel(pixel.x, pixel.y, pixel.c, e);
    }
  }

  private increaseCounter() {
    const storedVal = localStorage.getItem("placedPixels");
    let count = 1;
    if (storedVal) {
      count = parseInt(storedVal,) + 1;
    }
    localStorage.setItem("placedPixels", count.toString());
  }


  private async playSound() {
    if (!this.audio.paused) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this.audio.play();
  }

  onHover(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = this.calculateXPosition(e.clientX, rect);
    const y = this.calculateYPosition(e.clientY, rect);
    const pixel = this.findLatestPixel(x, y);
    if (e.shiftKey || e.altKey || e.ctrlKey) {
      console.log(pixel);
    }
    this.drawHoverPixel(x, y, pixel?.c, pixel?.p, false);

    if (pixel) {
      if (this.userFilter && this.userFilter != pixel.p) {
        return;
      }
      const text = `(${pixel.x}, ${pixel.y}) ${pixel.p || this.defaultUsername}<br/>${this.getLocalDate(pixel.t)}`;
      this.showBubble(text, e.clientX, e.clientY);
    }
    else {
      this.hideBubble();
    }
  }

  private getLocalDate(date: string) {
    let timestamp = moment.utc(date).local();
    timestamp.set
    if (moment.utc().diff(timestamp, 'hours') < 24) {
      return timestamp.add(-1, "seconds").fromNow(); //-1 second to ensure that the timestamp is not in the future
    } else {
      return timestamp.format("l") + " " + timestamp.format('LT');
    }
  }

  private findLatestPixel(x: number, y: number) {
    const max = this.isBoardLoaded ? this.sliderValue : this.boardArr.length;

    for (let i = max - 1; i >= 0; i--) {
      const item = this.boardArr[i];
      if ((!this.userFilter || this.userFilter == item.p) && item.x === x && item.y === y) {
        return item;
      }
    }
    return null;
  }


  private calculateXPosition(mouse: number, rect: any) {
    return Math.floor((mouse - rect.left) / rect.width * this.dimensions.width);
  }

  private calculateYPosition(mouse: number, rect: any) {
    return Math.floor((mouse - rect.top) / rect.height * this.dimensions.height);
  }

  private onLeave() {
    if (this.hoverPixel) {
      this.drawPixel(this.hoverPixel.x, this.hoverPixel.y, this.hoverPixel.c);
      this.hoverPixel = new HoverPixel(-1, -1, "", "")
    }
    this.hideBubble();
  }

  private drawHoverPixel(x: number, y: number, color: any, username: any, force: boolean) {
    if (!this.hoverPixel) {
      this.hoverPixel = new HoverPixel(x, y, color || this.defaultColor, username);
    }
    else if (this.hoverPixel.x !== x || this.hoverPixel.y !== y || force) {
      this.drawPixel(this.hoverPixel.x, this.hoverPixel.y, this.hoverPixel.c);

      this.hoverPixel = new HoverPixel(x, y, color || this.defaultColor, username);
      this.drawPixel(x, y, this.colorPalette[this.selectedColor]);
    }
  }

  private hideBubble() {
    const bubble = document.getElementById("bubble");

    if (bubble) {
      bubble.style.visibility = "hidden";
      bubble.style.opacity = "0";
      if (bubble.innerHTML.startsWith("Wait")) {
        bubble.innerHTML = "";
      }
    }
  }

  private showBubble(text: string, clientX: number, clientY: number) {
    const div = document.getElementById("bubble")!;
    if (div.innerHTML.startsWith("Wait")) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    div.innerHTML = text;

    let yOffset = div.clientHeight * 1.3;
    if (clientY - rect.top < yOffset) {
      yOffset = -20
    }
    let xOffset = div.clientWidth * 1.15;
    if (clientX - rect.left < rect.width - xOffset) {
      xOffset = -30
    }

    div.style.visibility = "visible";
    div.style.opacity = "1";
    div.style.left = `${clientX - xOffset}px`;
    div.style.top = `${clientY - yOffset}px`;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(this.hideBubble, 2000) as unknown as number;
  }

  private async loadBoard() {
    //const limit = 100000;
    //let offset = 0;

    let pixels;

    try {
      //do {
      const result = await this.fetchWithProgress(environment.endpointUrl + `/Board`);
      const websocketPixels = this.boardArr;
      this.boardArr = await result.json();
      this.boardArr = this.boardArr.concat(websocketPixels);
      // By prepending the board state, the websocket pixels are on the correct index of the board
      this.drawBoard();
      this.drawHoverPixel(this.hoverPixel.x, this.hoverPixel.y, this.hoverPixel.c, this.hoverPixel.p, true)
      this.updateLeaderboard();

      //  offset += limit;
      //}
      //while (pixels.length == limit);
    }
    catch (error: any) {
      if (error instanceof Error && !error.message.toLowerCase().includes('fetch')) {
        alert("An error occured while loading the canvas: " + error.message);
        document.getElementById('loadingOverlay')!.style.display = 'none';
      }
    }
    document.getElementById('loadingOverlay')!.style.display = 'none';
    this.isBoardLoaded = true;
    this.setSliderToMax();
  }

  async fetchWithProgress(url: string): Promise<Response> {
    const response = await fetch(url);
    let totalMegabytes = 0;

    const reader = response.body?.getReader();

    const stream = new ReadableStream({
      start: (controller) => {
        const processText = async ({ done, value }: ReadableStreamReadResult<Uint8Array>) => {
          if (done) {
            controller.close();
            return;
          }

          totalMegabytes += value.length / 1024 ** 2;

          this.progress = `${totalMegabytes.toFixed(2)} MB fetched...`;
          this.pixelEstimate = `(~${Math.round(totalMegabytes * 14) * 1024} pixels)`;
          controller.enqueue(value);
          reader?.read().then(processText);
        };

        reader?.read().then(processText);
      }
    });

    return new Response(stream);
  }




  private setSliderToMax() {
    setTimeout(() => {
      this.sliderOptions = {
        ...this.sliderOptions,
        ceil: this.boardArr.length
      };
      this.sliderValue = this.sliderOptions.ceil
    });
  }

  private updateLeaderboard() {
    this.leaderboard = [];

    let max = this.boardArr.length;
    if (this.isBoardLoaded) {
      max = this.sliderValue;
    }

    for (let i = 0; i < max; i++) {
      const pixel = this.boardArr[i];
      const existingEntry = this.leaderboard.find(item => item.name === pixel.p);
      if (existingEntry) {
        existingEntry.placedPixels++;
      }
      else {
        this.leaderboard.push({ name: pixel.p, placedPixels: 1 });
      }
    };

    const list = document.getElementById('leaderboard-list')!;
    list.innerHTML = '';
    this.leaderboard.sort((a, b) => b.placedPixels - a.placedPixels);

    for (let i = 0; i < Math.min(10, this.leaderboard.length); i++) {
      if (!this.userFilter || this.userFilter == this.leaderboard[i].name) {
        const position = i + 1;
        const percentage = (this.leaderboard[i].placedPixels / (this.sliderValue || this.boardArr.length) * 100).toFixed(2);

        const element = document.createElement('li');
        element.className = 'leaderboard-item';

        element.innerHTML = `
        <span class="position">${position}.</span>
        <span class="name">${this.leaderboard[i].name}</span>
        <span class="score"># ${this.leaderboard[i].placedPixels}<br></br>${percentage}%</span>
        `;
        list.appendChild(element);
      }
    }

  }

  public onSliderChange() {
    clearTimeout(this.debounceTimeout);

    this.debounceTimeout = setTimeout(() => {
      this.setSliderColor();
      this.drawBoard();
      this.updateLeaderboard();
    }, 1);
  }

  public onSliderStart(): void {
    this.sliderDragState = true;
  }

  public onSliderEnd(): void {
    this.sliderDragState = false;
  }

  private getValidPixelOrNull(x: number, y: number, c: any, placedBy: any, updatedAt: any) {
    if (x < 0 || x >= this.dimensions.width || y < 0 || y >= this.dimensions.height) {
      return null;
    }

    //Check if hex is valid
    const reg = /^[0-9A-F]{6}$/i;
    if (!c || !reg.test(c)) {
      c = this.defaultColor;
    }
    return new Pixel(x, y, c, placedBy, updatedAt);
  }

  private async sendPixel(x: number, y: number, color: string, e: MouseEvent) {
    const originalPixel = this.findLatestPixel(x, y);

    //Abort task if same pixel by same user already exits.
    if (originalPixel && originalPixel.c === color && originalPixel.p === this.username) {
      return;
    }

    const newPixel = new Pixel(x, y, color, this.username, "")
    if (this.getIndex(newPixel) != -1) {
      return;
    }
    this.pixelQueue.push(newPixel)
    this.playSound();
    if (this.signalRService.getState() == HubConnectionState.Disconnecting || this.signalRService.getState() == HubConnectionState.Disconnected) {
      this.initSignalR();
    }
    try {
      const pixelToSend = {
        ...newPixel,
        t: new Date()
      };

      const response = await fetch(environment.endpointUrl + "/Pixel", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify(pixelToSend)
      })

      this.pixelQueue.splice(this.getIndex(newPixel), 1);

      if (response.ok) {
        this.increaseCounter();
        console.log('Success.');
      }
      else if (response.status === 429) {
        this.showBubble(`Wait ${response.headers.get("retry-after")} seconds.`, e.clientX, e.clientY);
        this.hoverPixel = new HoverPixel(-1, -1, "", "");
        this.drawBoard();
      }
    }
    catch (e) {
      this.pixelQueue.splice(this.getIndex(newPixel), 1);
      this.hoverPixel = new HoverPixel(-1, -1, "", "");
      this.drawBoard();
      console.log(e);
    }
  }


  private drawBoard() {

    let pixelLimit = this.isBoardLoaded ? this.sliderValue : this.boardArr.length;
    const imageData = this.context.createImageData(this.dimensions.width, this.dimensions.height);
    const data = imageData.data;

    const writePixelToData = (hex: string, x: number, y: number) => {
      const bigint = parseInt(hex, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      const index = (y * this.dimensions.width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    };

    for (let i = 0; i < pixelLimit; i++) {
      const p = this.boardArr[i];
      if (!this.userFilter || p.p == this.userFilter) {
        writePixelToData(p.c, p.x, p.y);
      }
    }

    this.context.putImageData(imageData, 0, 0);
  }

  private drawPixel(x: number, y: number, c: string) {

    if (this.getValidPixelOrNull(x, y, c, null, null) == null) {
      return;
    }

    this.context.fillStyle = '#' + c;
    this.context.fillRect(x, y, 1, 1);
  }

  public usernameChange(event: Event) {
    const val = (event.target as HTMLInputElement).value
    if (val.length > this.maxUsernameLength) {
      (event.target as HTMLInputElement).value = this.username;
      alert("Username cannot be longer than 16 characters.");
      return;
    }
    else if (val.toLowerCase().includes("[deleted]")) {
      (event.target as HTMLInputElement).value = this.username;
      alert("'[deleted]' is not an allowed username.");
      return;
    }
    this.username = val;
    localStorage.setItem("username", val);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault()
    if (e.shiftKey || e.ctrlKey || e.altKey) {
      return;
    }
    this.panzoom.zoomWithWheel(e, { animate: false });
    this.savePanzoomState();
    //this.updateGrid();

  }

  private updateGrid() {
    const rect = this.canvas.getBoundingClientRect();
    const parentRect = this.canvas.parentElement.getBoundingClientRect();

    const canvasWidth = rect.width;
    const canvasHeight = rect.height;

    const cellSize = 1.5; // Size of each grid cell in pixels
    const thickness = 0.1; // Grid line thickness in pixels

    // Calculate scale factors
    const scaleX = canvasWidth / (this.dimensions.width * cellSize);
    const scaleY = canvasHeight / (this.dimensions.height * cellSize);

    // Apply scaling and translation
    this.grid.style.transform = `scale(${scaleX}, ${scaleY}) translate(${thickness}px, ${thickness}px)`;
  }

  private savePanzoomState() {
    const pan = this.panzoom.getPan();
    const x = pan.x;
    const y = pan.y;

    const scale = this.panzoom.getScale();

    // If there are no changes then the operation should be canceled.
    const map = this.route.snapshot.queryParamMap;
    if (map.get('x') == x.toString() && map.get('y') == y.toString() && map.get('scale') == scale.toString()) {
      return;
    }

    this.panzoomRouting = true;
    localStorage.setItem('panzoomState', JSON.stringify({ x: x, y: y, scale }));

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { x: Math.round(x), y: Math.round(y), scale: Math.round(scale) },
      queryParamsHandling: 'merge'
    });
  }

  private restorePanzoomState() {
    const savedState = localStorage.getItem('panzoomState');
    if (!savedState) {
      return;
    }
    const state = JSON.parse(savedState);
    this.panzoom.zoom(state.scale);
    setTimeout(() => this.panzoom.pan(state.x, state.y), 200)
  }

  private updatePanZoomFromParams(params: Params) {
    if (this.panzoomRouting) {
      this.panzoomRouting = false;
      return;
    }

    let { x, y, scale } = params;

    if (isNaN(x) || isNaN(y) || isNaN(scale)) {
      return;
    }

    if (x && y && scale) {
      localStorage.setItem('panzoomState', JSON.stringify({ x, y, scale }));
    }
    else {
      const stored: ViewSettings = JSON.parse(localStorage.getItem("panzoomState") || "{}");
      ({ x, y, scale } = stored);
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { x: Math.round(x), y: Math.round(y), scale: Math.round(scale) },
    });
    this.restorePanzoomState();
  }

  private getIndex(p: Pixel): number {
    return this.pixelQueue.findIndex(item => item.x == p.x && item.y == p.y && item.c == p.c && item.p == p.p);
  }
}
